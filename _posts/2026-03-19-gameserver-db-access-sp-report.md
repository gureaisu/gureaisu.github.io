---
layout:       post
title:        "GameServer 存取 DB（只做報表寫入）— SP 參數對照文件"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - C#
    - Game Server
    - MySQL
    - 資料庫
    - 報表
---

> 本文目的：在後續把「報表寫入」改成直連 MySQL 執行預存程序時，能快速定位：
> - GameServer 目前「局報表 / 個人報表」實際寫入位置在哪裡
> - 現行程式送出的欄位長什麼樣
> - 兩個 SP（`sp_Game_GameRoundReportAdd`、`sp_Game_MemberReportAdd`）如何逐參數對應到現有 report 欄位
>
> 本文**只做文件**（不包含程式改動）。

---

## 1. 現況：報表寫入的資料流（目前走 XPG API）

### 1.1 背景任務入口

GameServer 將寫入「局報表」與「個人報表」交給背景 worker，委派流程在：

- `GameController.BgMain.cs`
  - `runBwWriteInningReport(BwInningReport info)`
    - `Program.Controller.GetLobbyAdapter(info.Report.ContentID)`
    - 取得 `ContentLobbyAdapter` 後呼叫 `adapter.WriteInningReport(info.Report)`
  - `runBwWriteMemberReport(BwMemberReport info)`
    - 取得 `ContentLobbyAdapter` 後呼叫 `adapter.WriteMemberReport(info.Report, info.FinalMoney)`

> `GameController.BgMain.cs` 裡對 `ManagerDB.Inst.WriteInningReport(...)` 與 `ManagerDB.Inst.WriteMemberReport(...)` 是**註解掉的**（目前報表寫入走 Adapter 的 override，而不是走 `IDbProvider`）。

### 1.2 實際委派給哪個 Adapter

報表由 `ContentLobbyAdapter` 子類別（各遊戲的 `LobbyAdapter.Report.cs`）負責實作：

- GuessSong：`GuessSongLobbyAdapter.Report.cs`
- Rocket：`RocketLobbyAdapter.Report.cs`

兩者目前都在 `WriteInningReport` / `WriteMemberReport` 中 switch：

- `case DBUseSystem.XpgApi:` 呼叫 `write..._ByXpgApi(...)`
- 其它模式目前回傳固定成功/0（未改動前不會寫到 DB）

---

## 2. GuessSong：目前「局/個人報表」送出的欄位

### 2.1 局報表（`WriteInningReport` → `GameRoundReportAdd`）

`writeInningReport_ByXpgApi(...)` 組合 JSON 時目前送出：

| 欄位 | 來源 |
|------|------|
| `GameID` | `this.GameID`（字串） |
| `TotalBet` | `report.TotalBets` |
| `TotalPayout` | `report.TotalPayout` |
| `WinLose` | `report.TotalWinLose` |
| `Rake` | `report.Rake` |
| `StartTime` | `report.InningTime` |
| `EndTime` | `DateTimeOffset.Now` |
| `SettleTime` | `DateTimeOffset.Now` |
| `GSRoundSetId` | `report.SequenceID` |
| `GSRoundId` | `$"{report.SequenceID}_{report.InningID}"` |
| `Round` | `report.Round` |
| `SongAnswer` | `report.SongAnswer` |
| `CorrectCount` | `report.CorrectCount` |

> `p_Odds` 需要 `decimal(10,4)`；GuessSong 目前沒有對應欄位 → 實作 SP 呼叫時可用 `0`。  
> SP 需要 `p_Created`，但現行 JSON 不包含 → 實作 SP 呼叫時需補（建議 `DateTimeOffset.Now`）。

### 3.2 GuessSong 個人報表（`WriteMemberReport` → `MemberReportAdd`）

`writeMemberReport_ByXpgApi(...)` 組合 JSON 時目前送出：

| 欄位 | 來源 |
|------|------|
| `GameId` | `this.GameID`（字串） |
| `MemberId` | `report.MemberID` |
| `Account` | `paras.Account`（`report.PlayerParas` 轉型為 `DBXpgApi.XpgSystemParas`） |
| `CompanyId` | `paras.CompanyId` |
| `StreamChannelId` | `report.LoginSourceID` |
| `Currency` | `paras.Currency` |
| `Bet` | `report.Bets` |
| `Payout` | `report.Payout` |
| `WinLose` | `report.WinLose` |
| `BetTime` | `report.InningTime` |
| `SettleTime` | `DateTimeOffset.Now` |
| `GSRoundId` | `$"{report.SequenceID}_{report.InningID}"` |
| `TeamIndex` | `report.TeamIndex` |
| `TotalScore` | `report.TotalScore` |
| `IsCorrect` | `report.IsCorrect` |

> `p_Odds` 與 `p_Created` 均未包含在現行 JSON → 實作 SP 呼叫時需補。

---

## 3. Rocket：目前「局/個人報表」送出的欄位

### 3.1 局報表（`WriteInningReport` → `GameRoundReportAdd`）

`writeInningReport_ByXpgApi(...)` 組合 JSON 時目前送出：

| 欄位 | 來源 |
|------|------|
| `GameID` | `this.GameID`（字串） |
| `TotalBet` | `report.TotalBets` |
| `TotalPayout` | `report.TotalPayout` |
| `WinLose` | `report.TotalWinLose` |
| `Rake` | `report.Rake` |
| `StartTime` | `report.InningTime` |
| `EndTime` | `DateTimeOffset.Now` |
| `SettleTime` | `DateTimeOffset.Now` |
| `GSRoundSetId` | `report.SequenceID` |
| `GSRoundId` | `String.Format("{0}_{1}", report.SequenceID, report.InningID)` |
| `Odds` | `report.InningOdds`（Rocket 有 Odds） |

> `p_Odds` 可直接對應 `Odds`。  
> `p_Created` 現行 JSON 不包含 → 需要補（建議 `DateTimeOffset.Now`）。

### 4.2 Rocket 個人報表（`WriteMemberReport` → `MemberReportAdd`）

`writeMemberReport_ByXpgApi(...)` 組合 JSON 時目前送出：

| 欄位 | 來源 |
|------|------|
| `GameId` | `this.GameID`（字串） |
| `MemberId` | `report.MemberID` |
| `Account` | `paras.Account` |
| `CompanyId` | `paras.CompanyId` |
| `StreamChannelId` | `report.LoginSourceID` |
| `Currency` | `paras.Currency` |
| `Bet` | `report.Bets` |
| `Payout` | `report.Payout` |
| `WinLose` | `report.WinLose` |
| `Rake` | `report.Rake` |
| `BetTime` | `report.InningTime` |
| `SettleTime` | `DateTimeOffset.Now` |
| `GSRoundId` | `$"{report.SequenceID}_{report.InningID}"` |
| `Odds` | `report.PlayerOdds` |

> `p_Odds` 可直接對應 `Odds`。  
> `p_Created` 現行 JSON 不包含 → 需要補。

---

## 4. MySQL 預存程序：逐參數對照

> 已確認：`EXECUTE` 權限已授權、`paras.Currency` 與 `T_Currency.Code` 一致、`battle` schema、`port=3306`。

### 4.1 `sp_Game_GameRoundReportAdd` 參數對照

SP 定義參數：

| 參數 | 型態 |
|------|------|
| `p_GameId` | int |
| `p_StartTime` | datetime(6) |
| `p_EndTime` | datetime(6) |
| `p_TotalBet` | decimal(19,4) |
| `p_TotalPayout` | decimal(19,4) |
| `p_WinLose` | decimal(19,4) |
| `p_Rake` | decimal(19,4) |
| `p_SettleTime` | datetime(6) |
| `p_Created` | datetime(6) |
| `p_GSRoundId` | varchar(255) |
| `p_GSRoundSetId` | varchar(255) |
| `p_Odds` | decimal(10,4) |

對照表（適用於 GuessSong / Rocket，差異已標註）：

| SP 參數 | 對應來源（現行程式） | 備註 |
|---|---|---|
| `p_GameId` | `this.GameID`（需 `int.Parse(...)`） | 現行 `GameID` 是字串 |
| `p_StartTime` | `report.InningTime` | datetime(6) 精度需由 DB driver 轉換 |
| `p_EndTime` | `DateTimeOffset.Now` | 現行 JSON 有 `EndTime` |
| `p_TotalBet` | `report.TotalBets` | `decimal(19,4)` 對應 C# `Decimal` |
| `p_TotalPayout` | `report.TotalPayout` | |
| `p_WinLose` | `report.TotalWinLose` | |
| `p_Rake` | `report.Rake` | |
| `p_SettleTime` | `DateTimeOffset.Now` | |
| `p_Created` | （建議）`DateTimeOffset.Now` | 現行 JSON 不包含 `Created` |
| `p_GSRoundId` | `"{SequenceID}_{InningID}"` | `$"{report.SequenceID}_{report.InningID}"` |
| `p_GSRoundSetId` | `report.SequenceID` | |
| `p_Odds` | Rocket：`report.InningOdds`；GuessSong：`0` | GuessSong 目前沒有 odds 欄位 |

> **補充**：SP 內含 `UPDATE T_Bet SET GameRoundId = v_GameRoundId WHERE GSRoundId = p_GSRoundId;`，因此執行順序要確認：通常先有會員下注記錄（T_Bet 未綁 GameRoundId）再寫局報表（補上 GameRoundId）。

### 4.2 `sp_Game_MemberReportAdd` 參數對照

SP 定義參數：

| 參數 | 型態 |
|------|------|
| `p_MemberId` | int |
| `p_Currency` | nvarchar(50) |
| `p_GameId` | int |
| `p_GSRoundId` | varchar(255) |
| `p_Bet` | decimal(19,4) |
| `p_BetTime` | datetime(6) |
| `p_SettleTime` | datetime(6) |
| `p_Payout` | decimal(19,4) |
| `p_WinLose` | decimal(19,4) |
| `p_Rake` | decimal(19,4) |
| `p_Created` | datetime(6) |
| `p_Odds` | decimal(10,4) |
| `p_StreamChannelId` | INT |

對照表（適用於 GuessSong / Rocket，差異已標註）：

| SP 參數 | 對應來源（現行程式） | 備註 |
|---|---|---|
| `p_MemberId` | `report.MemberID` | |
| `p_Currency` | `paras.Currency` | 已確認等於 `T_Currency.Code` |
| `p_GameId` | `this.GameID`（需 `int.Parse(...)`） | 現行 `GameID` 是字串 |
| `p_GSRoundId` | `"{SequenceID}_{InningID}"` | 同 4.1 |
| `p_Bet` | `report.Bets` | `Decimal` → `decimal(19,4)` |
| `p_BetTime` | `report.InningTime` | datetime(6) 精度 |
| `p_SettleTime` | `DateTimeOffset.Now` | |
| `p_Payout` | `report.Payout` | |
| `p_WinLose` | `report.WinLose` | |
| `p_Rake` | Rocket：`report.Rake`；GuessSong：`0`（需確認）| GuessSong member JSON 目前沒有送 `Rake` |
| `p_Created` | （建議）`DateTimeOffset.Now` | 現行 JSON 不包含 `Created` |
| `p_Odds` | Rocket：`report.PlayerOdds`；GuessSong：`0` | GuessSong 沒有 Odds |
| `p_StreamChannelId` | `report.LoginSourceID` | 現行把 `StreamChannelId` 指向登入來源 |

**重要差異（GuessSong）**：`sp_Game_MemberReportAdd` 需要 `p_Rake`、`p_Odds`、`p_Created`，但 GuessSong 現行 JSON 均未送出。後續實作直連 SP 時需補齊這些參數（通常設為 `0` 或按遊戲規則取得值）。

---

## 5. MySQL 預存程序：逐參數對照（對應你提供的 SP）

本段把 SP 參數逐一列出，並標註它目前在 GameServer 哪裡取得。

> 你已確認：`EXECUTE` 權限已授權、`paras.Currency` 與 `T_Currency.Code` 一致、`battle` schema、`port=3306`。

### 5.1 `sp_Game_GameRoundReportAdd` 參數對照

SP 定義參數：

| 參數 | 型態 |
|------|------|
| `p_GameId` | int |
| `p_StartTime` | datetime(6) |
| `p_EndTime` | datetime(6) |
| `p_TotalBet` | decimal(19,4) |
| `p_TotalPayout` | decimal(19,4) |
| `p_WinLose` | decimal(19,4) |
| `p_Rake` | decimal(19,4) |
| `p_SettleTime` | datetime(6) |
| `p_Created` | datetime(6) |
| `p_GSRoundId` | varchar(255) |
| `p_GSRoundSetId` | varchar(255) |
| `p_Odds` | decimal(10,4) |

對照表（適用於 GuessSong / Rocket，差異已標註）：

| SP 參數 | 對應來源（現行程式） | 備註 |
|---|---|---|
| `p_GameId` | `this.GameID`（需 `int.Parse(...)`） | 現行 `GameID` 是字串 |
| `p_StartTime` | `report.InningTime` | datetime(6) 精度需由 DB driver 轉換 |
| `p_EndTime` | `DateTimeOffset.Now` | 現行 JSON 有 `EndTime` |
| `p_TotalBet` | `report.TotalBets` | `decimal(19,4)` 對應 C# `Decimal` |
| `p_TotalPayout` | `report.TotalPayout` | |
| `p_WinLose` | `report.TotalWinLose` | |
| `p_Rake` | `report.Rake` | |
| `p_SettleTime` | `DateTimeOffset.Now` | |
| `p_Created` | （建議）`DateTimeOffset.Now` | 現行 JSON 不包含 `Created` |
| `p_GSRoundId` | `"{SequenceID}_{InningID}"` | `$"{report.SequenceID}_{report.InningID}"` |
| `p_GSRoundSetId` | `report.SequenceID` | |
| `p_Odds` | Rocket：`report.InningOdds`；GuessSong：`0` | GuessSong 目前沒有 odds 欄位 |

> **補充**：SP 內含 `UPDATE T_Bet SET GameRoundId = v_GameRoundId WHERE GSRoundId = p_GSRoundId;`，因此執行順序要確認：通常先有會員下注記錄（T_Bet 未綁 GameRoundId）再寫局報表（補上 GameRoundId）。

### 5.2 `sp_Game_MemberReportAdd` 參數對照

SP 定義參數：

| 參數 | 型態 |
|------|------|
| `p_MemberId` | int |
| `p_Currency` | nvarchar(50) |
| `p_GameId` | int |
| `p_GSRoundId` | varchar(255) |
| `p_Bet` | decimal(19,4) |
| `p_BetTime` | datetime(6) |
| `p_SettleTime` | datetime(6) |
| `p_Payout` | decimal(19,4) |
| `p_WinLose` | decimal(19,4) |
| `p_Rake` | decimal(19,4) |
| `p_Created` | datetime(6) |
| `p_Odds` | decimal(10,4) |
| `p_StreamChannelId` | INT |

對照表（適用於 GuessSong / Rocket，差異已標註）：

| SP 參數 | 對應來源（現行程式） | 備註 |
|---|---|---|
| `p_MemberId` | `report.MemberID` | |
| `p_Currency` | `paras.Currency` | 已確認等於 `T_Currency.Code` |
| `p_GameId` | `this.GameID`（需 `int.Parse(...)`） | 現行 `GameID` 是字串 |
| `p_GSRoundId` | `"{SequenceID}_{InningID}"` | 同 5.1 |
| `p_Bet` | `report.Bets` | `Decimal` → `decimal(19,4)` |
| `p_BetTime` | `report.InningTime` | datetime(6) 精度 |
| `p_SettleTime` | `DateTimeOffset.Now` | |
| `p_Payout` | `report.Payout` | |
| `p_WinLose` | `report.WinLose` | |
| `p_Rake` | Rocket：`report.Rake`；GuessSong：`0`（需確認）| GuessSong member JSON 目前沒有送 `Rake` |
| `p_Created` | （建議）`DateTimeOffset.Now` | 現行 JSON 不包含 `Created` |
| `p_Odds` | Rocket：`report.PlayerOdds`；GuessSong：`0` | GuessSong 沒有 Odds |
| `p_StreamChannelId` | `report.LoginSourceID` | 現行把 `StreamChannelId` 指向登入來源 |

**重要差異（GuessSong）**：`sp_Game_MemberReportAdd` 需要 `p_Rake`、`p_Odds`、`p_Created`，但 GuessSong 現行 JSON 均未送出。後續實作直連 SP 時需補齊這些參數（通常設為 `0` 或按遊戲規則取得值）。

---

## 6. 前置條件（已確認）

| 項目 | 狀態 |
|------|------|
| MySQL schema | `battle` |
| MySQL port | `3306` |
| `EXECUTE` 權限 | 已授權 |
| `paras.Currency` 與 `T_Currency.Code` | 一致 |

---

## 7. 直連 MySQL/Redis 時設定項建議（文件用，不含實作）

現行 `_Config.json` 主要用的是：

- `DB_ConnString` / `Wallet_ConnString`：目前被 `DBXpgApi` 當作 REST API base URL 使用
- `SystemRunMode`：決定 `ManagerDB.Inst` 選哪個 `IDbProvider`

因為「先只做報表寫入」，通常會在 Adapter 的 `WriteInningReport` / `WriteMemberReport` 改成直連 MySQL 執行 SP。

因此建議你新增（或準備新增）類似下列設定 key（名稱可自訂）：

- MySQL ReadWrite
  - `MySqlHost_RW`
  - `MySqlPort`（預設 3306）
  - `MySqlUser_RW`
  - `MySqlPassword_RW`
  - `MySqlDatabase`（battle）
- Redis
  - `RedisHost`
  - `RedisPort`（6379）
  - `RedisPassword`

若你同時也要做「讀資料/歷史」快取，才需要搭配 MySQL Read 與 Redis 讀寫策略。

---

## 8. 驗證 Checklist（後續做程式改動後才需要執行）

1. 啟動伺服器並確定該 Content 的 `WriteInningReport` / `WriteMemberReport` 有走到 MySQL SP（而不是原本的 XPG API）。
2. 觸發至少一次：
   - 局報表：寫入 `T_GameRound`（確認 `GameRoundSetId`、`GSRoundId`、`Odds`、`Rake`、`SettleTime` 等欄位）
   - 個人報表：寫入 `T_Bet`（確認 `MemberId`、`Currency`、`BetTime`、`Odds`、`StreamChannelId` 等）
3. 特別驗證 Rocket 的 `p_Odds`：
   - Rocket inning/member 的 `Odds` 是否正確落到 `T_GameRound.Odds` 與 `T_Bet.Odds`
4. 特別驗證 GuessSong 的補參數行為：
   - GuessSong 如果 `p_Odds` / `p_Rake` 沒有對應值，是否符合 DBA/DB 約束（例如 0 是否允許）
5. 確認局報表 SP 內的 UPDATE 是否成功：
   - `sp_Game_GameRoundReportAdd` 內的 `UPDATE T_Bet SET GameRoundId = v_GameRoundId WHERE GSRoundId = p_GSRoundId;`
   - 應該能在插入局報表後看到 `T_Bet.GameRoundId` 被更新。

---

## 9. Mermaid（資料流參考）

```mermaid
flowchart TD
    A[GameController.BgMain 主背景任務] -->|"runBwWriteInningReport"| B[GetLobbyAdapter(ContentID)]
    B -->|"WriteInningReport"| C[GuessSongLobbyAdapter/RocketLobbyAdapter]
    A -->|"runBwWriteMemberReport"| D[GetLobbyAdapter(ContentID)]
    D -->|"WriteMemberReport"| E[GuessSongLobbyAdapter/RocketLobbyAdapter]
    C -->|"目前: ByXpgApi 呼叫 REST"| F[XPG API]
    E -->|"目前: ByXpgApi 呼叫 REST"| F
```
