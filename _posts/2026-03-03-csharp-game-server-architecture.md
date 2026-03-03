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

## 技術堆疊

| 類別 | 技術 |
|------|------|
| 語言/框架 | C# / .NET 8.0 / Windows Forms |
| 通訊協定 | WebSocket / WSS（可切換） |
| 日誌系統 | NLog + Google Cloud Logging |
| HTTP 客戶端 | IHttpClientFactory |
| JSON 處理 | Newtonsoft.Json |

## 目錄結構

```
Code/
├── GameServer/
│   ├── GameController.*.cs    # 核心控制器（Partial Class 拆分）
│   ├── CeEngine/              # 自建遊戲引擎（網路層、房間管理）
│   ├── Content/
│   │   ├── Rocket/            # 火箭遊戲
│   │   ├── Mahjong/           # 麻將遊戲
│   │   └── Minesweeper/       # 踩地雷遊戲
│   └── DB/                    # 資料庫抽象層（REST API 對接）
└── _setting/                  # 設定檔（JSON / XML）
```

## 核心架構

### 1. 單執行緒主循環（100ms Timer）

所有遊戲邏輯在主循環依序執行，搭配命令佇列解決多執行緒競態問題：

- **網路執行緒** → 推入命令佇列
- **主循環** → 單執行緒逐一消費命令

這種設計避免了鎖（Lock）的複雜性，讓遊戲邏輯完全跑在單一執行緒，大幅降低 Race Condition 的風險。

### 2. Partial Class 職責分離

`GameController` 拆成 9 個 `.cs` 檔，各負責獨立功能：

- 登入驗證
- 命令路由
- DB 操作
- NPC 管理
- 背景排程等

Partial Class 是 C# 特有的機制，在不拆分類別名稱的前提下，讓大型控制器的程式碼依職責分散到不同檔案，維護上更清晰。

### 3. 策略模式（DB 提供者）

透過 `IDbProvider` 介面，依設定切換：

- `DBTester` — 本機測試 Mock
- `DBXpgApi` — 正式環境 REST API

開發與正式環境之間只需修改設定檔，不需要更動任何邏輯程式碼。

### 4. Content / LobbyAdapter 模式

每個遊戲實作 `ContentLobbyAdapter`，`GameController` 統一路由命令至各遊戲，新增遊戲只需實作介面，不影響核心控制器。

## 遊戲內容

目前包含三款遊戲，均支援：

- **NPC 機器人系統**：自動模擬真實玩家行為維持熱度
- **三層房間結構**：`GameID → Type → Level → Room`
- **大廳介接器**：統一管理房間列表、進房、自動配房

## 通訊協定

Client ↔ Server 使用 **WebSocket JSON** 格式：

```json
{ "cmd": "命令字串", "data": { ...命令資料... } }
```

主要命令分三類：

1. **系統命令**：心跳、維護通知、斷線
2. **玩家大廳命令**：登入、選房、進房、提款
3. **後台管理命令**：踢人、更新錢包（限特定 IP）

## 外部依賴

本系統不直接連接資料庫，改透過 **REST API** 對接：

- **Game API**（`DB_ConnString`）：玩家登入／登出驗證
- **Wallet API**（`Wallet_ConnString`）：餘額查詢、存提款

這種設計讓遊戲伺服器本身保持無狀態（Stateless），資料層完全由外部 API 管理，有利於水平擴展。

## 關機機制

三步驟優雅關機（各步驟秒數可設定）：

| 步驟 | 預設時間 | 動作 |
|------|----------|------|
| Step 1 | 300 秒 | 通知所有玩家維護即將開始 |
| Step 2 | 180 秒 | 強制踢離所有玩家 |
| Step 3 | 120 秒 | 關閉 Socket、重置內容、退出程式 |

優雅關機確保玩家不會在遊戲進行中被突然斷線，提升整體使用體驗。
