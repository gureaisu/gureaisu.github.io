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

## 5. L1（`mysql-l1`）結果如何解讀

- **`[mysql-l1] done errors=X/Y`**：`Y` 為迭代次數；`X=0` 表示該次執行中，沒有迭代因例外而失敗。
- **`op latency`**：在 `fullround` 模式下，統計的是**單次迭代內「整包」**耗時（依 `member` 人數：多次 `sp_Game_MemberReportAdd` → `sp_Game_GameRoundReportAdd` → 多次 `sp_Game_MemberBetSetFinalRank`），單位為**微秒（µs）**；不是單一 SP 的耗時。
- **`GSRoundId` 前綴**：預設 `STRESS`，便於在 `T_Bet` / `T_GameRound` 查詢或配合清理腳本。

前提：`T_Member`、`T_Currency`（例如 `GPGG`）與 SP 已在目標庫就緒。

---

## 6. L2 要怎麼「執行」

L2 **不是**一條獨立 CLI，而是：**GameServer 開著 + 直連字串已設 + 用 `ws-e2e`（或 `soak`）拉高並行房數／結算頻率**，同時觀察：

- GameServer 日誌：如 `[GuessSong][MySql]`。
- MySQL：`Threads_running`、slow log、鎖等待（視需要）。
- 是否出現因報表失敗導致的斷線或異常錯誤碼。

詳見壓測專案 `l2_gameserver_queue.md`。

---

## 7. 觀測指標（建議最低限度）

**MySQL：** `Threads_connected`、`Threads_running`、slow query／錯誤 log、必要時 InnoDB 狀態。

**GameServer：** CPU、記憶體、與報表相關錯誤日誌；多房同秒結算時，報表是否明顯落後。

**業務資料：** 依場次與人數核對 `T_Bet` 筆數、`GSRoundId` 與最後一輪 `FinalRank` 是否合理（與產品規則一致）。

---

## 8. 注意事項

- 僅在**隔離的測試／QA 資料庫**執行大量寫入；正式環境勿使用壓測前綴以外的任意寫入策略。
- **cmd.exe** 與 **PowerShell** 設定環境變數與引號規則不同；連線字串含分號時，cmd 請用 `set "VAR=整段..."` 或 `--conn "整段"`（見 README）。
- MySQL 預存程序上的「IDE 中斷點」往往無法等同應用程式偵錯；驗證是否執行以**寫入結果**與**伺服器日誌**為主。

---

## 9. 與其他文件的關係

- 猜歌報表欄位、SP 與部署可對照站內文章：[猜歌遊戲報表／T_Bet 擴充 — 異動說明](/2026/03/25/guesssong-dbreport-change-note/)、[GameServer 存取 DB — SP 參數對照](/2026/03/19/gameserver-db-access-sp-report/)。
- SQL 增量（範例路徑）：`temp/battle_T_Bet_guesssong_migration.sql`（與 `battle.sql` 對齊之一套 schema／程序）。

---

## 10. 修訂紀錄

| 日期 | 說明 |
|------|------|
| 2026-03-26 | 初版：彙整壓測分層、工具、L2 執行方式與結果解讀。 |
