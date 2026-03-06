---
layout:       post
title:        "C# .NET 8.0 遊戲伺服器架構分析"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - C#
    - .NET
    - WebSocket
    - Game Server
    - 架構設計
---

## 專案概覽

這是一個以 **C# (.NET 8.0)** 開發的遊戲伺服器，以 **Windows Forms** 作為管理介面，對外提供 WebSocket 連線服務，供遊戲客戶端連接。

## 技術棧

| 類別 | 技術 |
|------|------|
| 語言/框架 | C# / .NET 8.0 / Windows Forms |
| 通訊協定 | WebSocket / WSS（可切換） |
| 日誌系統 | NLog + Google Cloud Logging |
| HTTP 客戶端 | IHttpClientFactory |
| JSON 處理 | Newtonsoft.Json |

## MVC 架構

| 層 | 對應內容 |
|----|---------|
| **Model** | 所有 Content 專案（遊戲邏輯） |
| **View** | Windows Forms（已盡量減少使用）、Log、前後端 API |
| **Control** | `GameController`（主物件）及各管理物件 |

## 目錄結構

```
Code/
├── GameServer/
│   ├── GameController.*.cs    # 核心控制器（Partial Class 拆分）
│   ├── CeEngine/              # 自建遊戲引擎（網路層、房間管理）
│   ├── Content/
│   │   ├── Rocket/            # 火箭遊戲（ContentID: 2）
│   │   ├── Mahjong/           # 麻將遊戲
│   │   └── Minesweeper/       # 踩地雷遊戲
│   └── DB/                    # 資料庫抽象層（REST API 對接）
└── _setting/                  # 設定檔（JSON / XML）
    └── content/               # 各遊戲專屬設定檔
```

---

## 核心架構

### 1. GameController — 全局控制物件

`GameController` 是系統中最主要的底層框架物件，負責運行整個內在虛擬世界，具備自己的時間同步機制（每 0.1 秒觸發一次），幾乎掌控所有流程節點。

**採用設計模式：Mediator Pattern（中介者模式）**
> 定義一個中介者對象，封裝系統中對象間的交互方式。

以 Partial Class 拆分為 10 個檔案，各負責獨立職責：

| Part | 職責 |
|------|------|
| 本體 | 開關機入口函式、通用函式 |
| `.MainProcess` | 系統流程控管 |
| `.CmdCommon` | 使用者命令處理 |
| `.CmdAdmon` | 後端管理者命令處理 |
| `.CmdSubGame` | 副遊戲專用命令處理通道（目前保留未用） |
| `.DbAdapter` | 後端 API 窗口，隔離資訊層與 DB |
| `.BgMain` | 主背景處理區塊 |
| `.BgOption` | 副背景處理區塊 |
| `.NPC` | NPC 相關區塊 |
| `._Customize` | 客製化處理（新增 Content 須在此登錄） |

### 2. 管理物件群（Control Layer）

均採用 **Singleton Pattern**：

```
UserManager  ──→  Player
                  NpcPlayer
                  Tourist

RoomManager  ──→  GameRoom
                  MultiGame（主要實作）
                    ├── Rocket
                    └── Minesweeper
```

### 3. 系統主要機制

#### 主線時間同步機制
- 確保主系統內的物件不因時間差造成混亂（如玩家瞬間連線又斷線、命令時間差等）
- 啟動函式：`GameController.runSystemTimeSync()`
- 以 **0.1 秒為 1 幀**，依序進行非等待的處理作業

#### 命令傳送機制
- 採用 **Chain of Responsibility Pattern** 的概念，設計類似 C# event 機制
- 命令資料取得後依序傳遞，由命令擁有者物件取得後執行，然後結束傳遞
- 啟動函式：`GameController.onReceiveFromUser()`

### 4. 策略模式（DB 提供者）

透過 `IDbProvider` 介面，依設定切換：

- `DBTester` — 本機測試 Mock（`SystemRunMode: 0`）
- `DBXpgApi` — 正式環境 REST API（`SystemRunMode: 9`）

---

## 設定檔系統（GameSetting）

設定分為兩類，存放於 `_setting/` 資料夾：

### `_Config`（初始設定檔）— 啟動後無法變更

| 參數 | 說明 |
|------|------|
| `ServerName` | 伺服器名稱（顯示於 Form 和 NLog） |
| `ServerPort` | 綁定 Port |
| `LinkType` | 連線型別（1: 一般, 2: SSL） |
| `RunContents` | 欲運行的遊戲，格式：`GameID-ContentID:ClassName`，多個以逗號分隔（例：`1-2:Rocket,1-3:Minesweeper`） |
| `SystemRunMode` | 運行模式（0: 本機測試, 9: 正式環境） |
| `DB_ConnString` | Game API 連線字串 |
| `Wallet_ConnString` | Wallet Server 連線字串 |
| `IsIntegerSystem` | 是否為整數系統 |
| `SystemCheck_Notify` | 心跳檢測通知間隔（秒），0 表示由客端主動通知 |
| `SystemCheck_Timeout` | 心跳逾時（秒），≤0 為關閉 |
| `SysSD_Step1_Sec` | 關機程序 1 時間（通知玩家準備關機） |
| `SysSD_Step2_Sec` | 關機程序 2 時間（踢離所有玩家） |
| `SysSD_Step3_Sec` | 關機程序 3 時間（最後作業，時間到即關機） |

### `_System`（系統設定檔）— 啟動後可動態變更

| 參數 | 說明 |
|------|------|
| `MaintainSetWeek/Hour/Minute` | 定期維護時間設定 |
| `MaintainAfterHour` | 維護後保險機制，避免連續關機 |
| `ZombieConnectionCheck/Timeout` | 殭屍連線檢查時間與逾時 |
| `Timeout_LobbyIdle` | 大廳掛機逾時（保留） |
| `Timeout_RoomIdle` | 遊戲房掛機逾時（保留） |
| `Sequence_Limit` | 局號預備份數量 |
| `NpcWait_Limit` | NPC 預備數量（0 = 關閉 NPC 系統） |
| `NpcWait_TakeCount` | NPC 不足時一次補上的數量 |
| `Admin_AllowIPs` | 後端管理命令白名單 IP |

---

## Content System（遊戲內容層）

每個 Content 代表一套遊戲機制，需實作：

### 房間層級結構

```
GameID（遊戲廠商編號）
  └── ContentID（遊戲內容編號）
        └── Type（房型）
              └── Level（級別）
                    └── Room（遊戲房）
```

### ContentLobbyAdapter

每個遊戲需實作 `ContentLobbyAdapter`，負責：

1. 大廳相關命令（取得房間列表、進入指定房等）
2. 報表功能（三層）：
   - **將報表** `WriteSequenceReport`：最高層級，一將有數局
   - **局報表** `WriteInningReport`：單局遊戲資訊
   - **個人報表** `WriteMemberReport`：單局每位玩家的操作細項
3. 通用功能設計（建構創房資訊、創建公廳房、NPC 陪打系統等）

> ⚠️ 實作完成後，**必須在 `GameController._Customize` 的 `initialContents()` 函式中登錄**，否則 Config 設定無法生效。

### ContentRoom

遊戲房物件，主要實作 `MultiGame`（多人），由 `RoomManager` 統一管理（創建與銷毀都需操作 `RoomManager`）。

---

## 遊戲內容

### 火箭遊戲（Rocket）

- ContentID：`2`
- Room Type：目前一律為 `0`
- Level `1`：公廳房（系統啟動時生成，永續存在）
- Level `2`：自創房（玩家請求時生成，有時限）

設定檔：

| 檔案 | 說明 |
|------|------|
| `2_Rocket.xml` | 初始及整體設定 |
| `2_Rocket_Action.xml` | 飛行劇本 |
| `2_Rocket_TimeSetting.json` | 各場景時間（毫秒） |
| `2_Rocket_NPC.json` | NPC 導入及行為設定（目前無用） |

---

## 通訊協定

Client ↔ Server 使用 **WebSocket JSON** 格式：

```json
{ "cmd": "命令字串", "data": { ...命令資料... } }
```

命令分三類：

| 類別 | 範例 |
|------|------|
| 系統命令 | 心跳（`sschk`）、維護通知、斷線 |
| 玩家大廳命令 | 登入（`ln`）、選房、進房、提款 |
| 後台管理命令 | 踢人、更新錢包（限白名單 IP） |

---

## 關機機制

三步驟優雅關機（秒數可設定）：

| 步驟 | 對應設定 | 預設時間 | 動作 |
|------|----------|----------|------|
| Step 1 | `SysSD_Step1_Sec` | 300 秒 | 通知所有玩家維護即將開始 |
| Step 2 | `SysSD_Step2_Sec` | 180 秒 | 強制踢離所有玩家 |
| Step 3 | `SysSD_Step3_Sec` | 120 秒 | 關閉 Socket、重置內容、退出程式 |

---

## 外部依賴

本系統不直接連接資料庫，透過 **REST API** 對接：

- **Game API**（`DB_ConnString`）：玩家登入／登出驗證
- **Wallet API**（`Wallet_ConnString`）：餘額查詢、存提款
