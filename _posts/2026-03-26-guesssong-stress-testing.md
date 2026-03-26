---
layout:       post
title:        "GuessSong 直連 MySQL 壓力測試說明"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - C#
    - Game Server
    - GuessSong
    - MySQL
    - 壓力測試
---

本文整理猜歌報表**直連 MySQL（預存程序）**相關之壓力測試目的、分層、工具與解讀方式。命令列參數、環境變數與 PowerShell／cmd 差異以**壓測工具專案**內 `README.md` 為準；L2 佇列與觀測步驟見同專案之 `l2_gameserver_queue.md`。

---

## 1. 為什麼要壓測

猜歌每輪／全場結算會觸發寫庫（`T_Bet`、`T_GameRound` 與名次回填）。在玩家數、房數或結算節奏變高時，可能出現：

- MySQL 端：連線數、鎖競爭、寫入延遲升高。
- 應用端：報表工作排進**單一主背景 Worker**，佇列堆積、完成時間落後於局內流程。
- 使用者端：若個人報表寫入失敗且回傳負值，可能引發斷線等政策行為（需對照 GameServer 實作）。

壓測目的不是「跑一個數字」，而是**分層**區分瓶頸在資料庫、在應用佇列，或兩者兼有，以利優先順序與容量規劃。

---

## 2. 分層架構（L1 / L2 / L3）

| 層級 | 測什麼 | 典型作法 | 工具或方式 |
|------|--------|----------|------------|
| **L1 資料庫** | SP 與 schema 在**直接、可控制併發**下的吞吐與延遲、鎖行為 | 略過 GameServer，對 `battle` 併發呼叫三支猜歌相關 SP | `GuessSongStress` 子命令 **`mysql-l1`** |
| **L2 GameServer 報表管線** | **真實**結算路徑：命令進入背景佇列、單一 Worker 消化，與直連 DB 疊加 | 啟動 GameServer（已設定 `GuessSong_Report_ConnString`），製造多房／多結算 | **無獨立子命令**；以 **`ws-e2e`**（或浸泡 `soak`）產生負載，並觀察日誌與 DB，步驟見壓測專案 `l2_gameserver_queue.md` |
| **L3 端到端** | WebSocket、房間狀態機、題目與作答與結算**整條鏈路** | 自動化多條連線跑完整一局（遊客登入→建房→開局→多輪作答→結算） | `GuessSongStress` 子命令 **`ws-e2e`** |
| **浸泡（soak）** | 長時間穩定性、資源是否漂移、錯誤率是否累積 | 在一段時間內重複執行 L1 或 L3（指令間暫歇） | **`soak`** |

**建議順序：**先 **L1** 建立資料庫與 SP 的基準，再做 **L2 + L3**（真實伺服器），最後 **soak**。避免僅從 L1 推論線上容量，也避免未掌握 DB 極限就誤判為「程式慢」。

---

## 3. 與 GameServer 寫庫的對應關係（概念）

- **每輪結算**：對房內每位玩家 `WriteMemberReport`，再 `WriteInningReport`；兩者進入主背景佇列，由 **單一 `BackgroundWorker`** 依序執行（與登入、餘額等其他工作共用）。
- **全場結算**：`SetFinalRank`（直連時）在現行程式中為**同步**、逐人開連線，與上述背景佇列路徑不同；大房全場結束時可能出現短暫尖峰。

實作參考（於 GameServer 專案內）：`GuessSongReportMySqlDirect.cs`、`GuessSong.cs`（`writeRoundDbReports` / `writeFinalRankDbReports`）、`GameController.BgMain.cs`。

---

## 4. 工具程式與_repo 內檔案

| 項目 | 說明 |
|------|------|
| `GuessSongStress/GuessSongStress.csproj` | .NET 8 主程式：`mysql-l1`、`ws-e2e`、`soak` |
| `README.md` | 命令列範例、cmd.exe 與 PowerShell 差異（`dotnet run` 僅一個 `--`） |
| `l2_gameserver_queue.md` | L2 操作與觀測檢核 |
| `mysql_monitor_snippets.sql` | 壓測時輔助觀測 MySQL 狀態 |
| `stress_cleanup.sql` | 測試資料清理（**僅測試環境**；腳本內 `DELETE` 預設註解） |

環境變數 **`GUESSSONG_STRESS_CONN`**：`mysql-l1` 若未帶 `--conn` 時可讀取此變數（詳見壓測專案 README）。

---

## 5. 測試方式（步驟、參數與案例）

以下假設已在存放庫根目錄（例如 `D:\WorkDir\GPG\gs-rocket\code`），且已安裝 **.NET 8 SDK**。專案子命令為：`mysql-l1`、`ws-e2e`、`soak`。

### 5.1 通用命令列寫法

- `dotnet run` 只在 **`--` 出現一次**；緊接著第一個參數就是子命令（`mysql-l1` / `ws-e2e` / `soak`）。勿寫成 `-- -- mysql-l1`（會把 `--` 當成子命令）。
- **cmd.exe**：連線字串含分號時，建議 `--conn "Server=...;...;"` 或使用 `set "GUESSSONG_STRESS_CONN=整段"`（整段包在雙引號內，避免 `set` 被 `;` 截斷）。不要用 PowerShell 的 `$env:...`。
- **PowerShell**：可用 `$env:GUESSSONG_STRESS_CONN = '...'`（單引號便於密碼含反引號等字元），再執行 `dotnet run ... -- mysql-l1 ...`。
- 結束後可用 `echo %ERRORLEVEL%`（cmd）或 `$LASTEXITCODE`（PowerShell）看行程代碼：**0** 成功、**1** 子命令執行中有失敗、`mysql-l1` 參數錯誤時可能為 **2**。

取得內建說明：

```text
dotnet run --project temp/stress/GuessSongStress -- --help
```

### 5.2 L1：`mysql-l1`（純 MySQL SP）

**目的：**不經過 GameServer，直接對 `battle` 壓三支猜歌相關 SP，量**資料庫與鎖**的能耐；結果**不可**直接等同「線上 GameServer 能扛多少房」（還有單一背景 Worker 等因素，見 L2）。

**前置：**`T_Currency` 须有壓測用幣別（預設 `GPGG`）；每個 `--member` 之 `T_Member.Id` 须存在；SP 已部署。

**建議步驟：**

1. **冒煙：**小迭代、`threads=1`，確認 `errors=0`（例如 `--iterations 3 --threads 1 --mode member`）。
2. **基準：**`--threads 1 --iterations 20 --mode fullround`，記錄延遲分佈（接近「無併發爭用」參考）。
3. **加壓：**逐步提高 `--threads`（如 4→8→16）或 `--iterations`，比對 `errors` 與 `p95`/`p99`。
4. **模式切換：**
   - `member`：僅插入會員報表、每筆不同 `GSRoundId`，衝突較像「多路插入」。
   - `fullround`：同 `GSRoundId` 多會員 + 局報表 + 名次更新，較貼近真實一輪寫入順序與 `UPDATE T_Bet`。
   - `mixed`：兩種交錯，模擬負載混合。

**參數一覽：**

| 參數 | 說明 | 預設／備註 |
|------|------|------------|
| `--conn` | MySQL 連線字串 | 可改用環境變數 `GUESSSONG_STRESS_CONN` |
| `--member` | `T_Member.Id`，可重複出現多次 | 至少一個 |
| `--threads` | `Parallel.For` 最大並行度 | 預設 8 |
| `--iterations` | 迭代次數 | 預設 100 |
| `--mode` | `member` / `fullround` / `mixed` | 預設 fullround |
| `--game-id` | `p_GameId` | 預設 1001 |
| `--currency` | `p_Currency` | 預設 GPGG |
| `--prefix` | `GSRoundId` 前綴 | 預設 STRESS，便於查詢與清理 |

**cmd 範例：**

```bat
dotnet run --project temp\stress\GuessSongStress -- mysql-l1 --conn "Server=...;Port=3306;Database=battle;User ID=...;Password=...;" --member 10001 --member 10002 --threads 16 --iterations 200 --mode fullround
```

### 5.3 L3 與 L2：`ws-e2e`（端到端 + 驅動報表管線）

**L3（端到端）：**驗證 WebSocket 協定、房間流程、多輪作答與結算是否走完。  
**L2：**同一工具、同一負載；重點改在**觀察**：報表是否經主背景佇列堆積、日誌是否出現 `[GuessSong][MySql]`、是否有斷線等（見 [l2_gameserver_queue.md](l2_gameserver_queue.md)）。

**前置：**GameServer 已啟動；猜歌題庫可用；`_setting/_Config.json` 已設定 **`GuessSong_Report_ConnString`** 若要以本機流程寫入與線上相同的直連 DB。

**建議步驟：**

1. 單機驗證：`--rooms 1 --rounds 3`，確認輸出 `failures=0/1` 且日誌無報表錯誤。
2. **橫向（L2）：**提高 `--rooms`（如 8、16、32），製造「多房並行結算」；同步看 GameServer CPU 與 MySQL `Threads_running`。
3. **縮短每輪時間：**在伺服器允許範圍內調 `--round-sec`（程式下限 10），提高單位時間結算次數。
4. 若 `gsa` 回 **code=6**（非作答階段）：加大 `--answer-delay-ms`（預設 2500），避免題目剛推就送出。
5. 逾時：局很長或網路慢時加大 `--game-timeout-sec`（預設 600）。

**參數一覽：**

| 參數 | 說明 | 預設／備註 |
|------|------|------------|
| `--url` | WebSocket URL | 如 `ws://127.0.0.1:10001` |
| `--game-id` | 遊客 `ln` 的 gameId 字串 | 預設 1001 |
| `--content-id` | `gscr` 的 contentId | 預設 1002 |
| `--rooms` | 並行房數（每房一條連線、個人模式自創房） | 預設 4 |
| `--rounds` | 每房輪數 | 預設 3 |
| `--round-sec` | 每輪作答秒數（伺服器與程式下限 10） | 預設 20 |
| `--answer-delay-ms` | 收到 `gsq` 後延遲再送 `gsa` | 預設 2500 |
| `--game-timeout-sec` | 單房全流程逾時 | 預設 600 |

**補充：**目前 `ws-e2e` 為**每連線一個人、個人房**；若要 **同房多玩家**（縱向人數），需另開多條客戶端手動 `gsjr` 同一 `roomCode`，或使用 [temp/GuessSongTouristTest.html](../GuessSongTouristTest.html) 等多開瀏覽器，再配合一條 `ws-e2e` 只當「其中一房房主」——此情境需在測試計畫中單獨描述步驟。

### 5.4 浸泡：`soak`

**目的：**在**一段連續時間**內反覆執行 L1 或 L3，觀察記憶體、連線數、錯誤是否隨時間累積。

**參數：**`--target mysql-l1` 或 `ws-e2e`；`--minutes` 浸泡總分鐘數。其後若要傳自己的子命令參數，請使用 **`--`** 分隔（僅在 `soak` 這一層需要），例如 PowerShell：

```powershell
dotnet run --project temp/stress/GuessSongStress -- soak --target ws-e2e --minutes 120 -- --url ws://127.0.0.1:10001 --rooms 4 --rounds 3
```

`soak` 每次完整子命令後會暫停數秒（`ws-e2e` 約 20 秒、`mysql-l1` 約 5 秒），避免無間斷打滿。

### 5.5 測試案例矩陣（建議最少集）

| 案例 | 作法 | 觀察重點 |
|------|------|----------|
| 基準 | 單房／低併發（L3 `rooms=1`；L1 `threads=1`） | 功能正確、無錯誤 |
| 橫向 | L3 提高 `--rooms`；L1 提高 `--threads` | 延遲尾段、 errors、MySQL `Threads_running` |
| 縱向 | 同房多人（手動多客戶端或 HTML） | `FinalRank`、每人 `MemberReport` 筆數 |
| 尖峰 | 刻意同一時段開多房或縮短 `--round-sec` | 佇列延遲、斷線、日誌 |
| 浸泡 | `soak` 30～120 分鐘 | 資源是否漂移、錯誤率 |

### 5.6 通過準則與資料驗證（建議）

- **工具行程代碼：**`mysql-l1` / `ws-e2e` / `soak` 結束為 **0**；若 `ws-e2e` 顯示 `failures>0`，需保留主控台錯誤訊息與 GameServer 日誌對照。
- **L1 資料：**`T_Bet`／`T_GameRound` 可查 `GSRoundId LIKE 'STRESS%'`（未改 `--prefix` 時）；筆數應與模式、迭代次數、`member` 人數一致（例如 `fullround` 每迭代每人至少一筆 Member 報表 + 局端關聯邏輯）。
- **L3 真實局：**`GSRoundId` 格式由伺服器產生（如含 `SequenceID`、房碼等），請用**時間區間**或已知 `MemberId` + `GameId` 查 `T_Bet` 最新列，並核對最後一輪是否回填 `FinalRank`（與企劃一致）。

### 5.7 常見問題（對照）

| 現象 | 可能原因 | 處理方向 |
|------|----------|----------|
| `mysql-l1` 全部 `errors`、訊息含 initialization string | `--conn` 為占位字、`;` 被 cmd 截斷、引號錯誤 | 改用真實連線字串；cmd 用 `set "GUESSSONG_STRESS_CONN=..."` 或 `--conn "整段"` |
| `dotnet run` 顯示「未知命令: --」 | 多打了一個 `--`，或子命令前多出 `--` | 改為 `dotnet run ... -- mysql-l1 ...`（僅一個 `--`） |
| `ws-e2e` 中 `gsa` code=6 | 尚未進入可作答階段就送出答案 | 加大 `--answer-delay-ms`（見 §5.3） |
| `ws-e2e` 逾時 | 伺服器慢、`--round-sec` 過長、房數多 | 加大 `--game-timeout-sec` 或減少 `--rounds`／`--rooms` 先驗證 |
| L3 無寫庫 | 未設定 `GuessSong_Report_ConnString` 或連到錯誤 DB | 查 `_Config.json` 與 GameServer 日誌 |

---

## 6. L1（`mysql-l1`）輸出解讀

- **`[mysql-l1] done errors=X/Y`**：`Y` 為迭代次數；`X=0` 表示該次執行中，沒有迭代因例外而失敗。
- **`op latency`**：在 `fullround` 模式下，統計的是**單次迭代內「整包」**耗時（依 `member` 人數：多次 `sp_Game_MemberReportAdd` → `sp_Game_GameRoundReportAdd` → 多次 `sp_Game_MemberBetSetFinalRank`），單位為**微秒（µs）**；不是單一 SP 的耗時。
- **`GSRoundId` 前綴**：預設 `STRESS`，便於在 `T_Bet` / `T_GameRound` 查詢或配合清理腳本。

前提：`T_Member`、`T_Currency`（例如 `GPGG`）與 SP 已在目標庫就緒。

---

## 7. L2 執行概要

L2 **不是**一條獨立 CLI，而是：**GameServer 開著 + 直連字串已設 + 用 `ws-e2e`（或 `soak`）拉高並行房數／結算頻率**，同時觀察：

- GameServer 日誌：如 `[GuessSong][MySql]`。
- MySQL：`Threads_running`、slow log、鎖等待（視需要）。
- 是否出現因報表失敗導致的斷線或異常錯誤碼。

詳見 [l2_gameserver_queue.md](l2_gameserver_queue.md) 與上文 **§5.3**。

---

## 8. 觀測指標（建議最低限度）

**MySQL：** `Threads_connected`、`Threads_running`、slow query／錯誤 log、必要時 InnoDB 狀態。

**GameServer：** CPU、記憶體、與報表相關錯誤日誌；多房同秒結算時，報表是否明顯落後。

**業務資料：** 依場次與人數核對 `T_Bet` 筆數、`GSRoundId` 與最後一輪 `FinalRank` 是否合理（與產品規則一致）。

---

## 9. 注意事項

- 僅在**隔離的測試／QA 資料庫**執行大量寫入；正式環境勿使用壓測前綴以外的任意寫入策略。
- **cmd.exe** 與 **PowerShell** 設定環境變數與引號規則不同；連線字串含分號時，cmd 請用 `set "VAR=整段..."` 或 `--conn "整段"`（見 README）。
- MySQL 預存程序上的「IDE 中斷點」往往無法等同應用程式偵錯；驗證是否執行以**寫入結果**與**伺服器日誌**為主。

---

## 10. 與其他文件的關係

- 猜歌報表欄位、SP 與部署：見上層目錄之 `GuessSong_DBReport_異動說明.md`、`GameServer_DBAccess_SPReport.md`。
- SQL 增量：`temp/battle_T_Bet_guesssong_migration.sql`（與 `battle.sql` 對齊之一套 schema／程序）。

---

## 11. 修訂紀錄

| 日期 | 說明 |
|------|------|
| 2026-03-26 | 初版：彙整壓測分層、工具、L2 執行方式與結果解讀。 |
| 2026-03-26 | 增補 §5：測試方式（通用命令列、L1／L3／soak 步驟與參數表、案例矩陣、通過準則）。 |
