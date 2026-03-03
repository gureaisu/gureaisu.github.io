---
layout:       post
title:        "Python 遊戲伺服器健康監控微服務架構分析"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - Python
    - Flask
    - WebSocket
    - Google Cloud
    - 微服務
    - 架構設計
---

## 專案定位

這是一個**遊戲伺服器健康監控微服務**（pk-gs-check），部署在 **Google Cloud Run** 上，由外部排程（如 Cloud Scheduler）定期觸發，對所有已登錄的遊戲伺服器進行心跳探測。

## 技術棧

| 類別 | 技術 |
|------|------|
| 語言 | Python 3.11 |
| Web 框架 | Flask |
| 非同步 | asyncio |
| WebSocket | websockets 10.3 |
| HTTP 客戶端 | requests 2.32.x |
| 告警通知 | Telegram Bot（pyTelegramBotAPI 4.22.1） |
| 容器化 | Docker（python:3.11-slim） |
| CI/CD | Google Cloud Build |
| 部署平台 | Google Cloud Run（asia-southeast1） |

## 目錄結構

```
Code/
├── app.py              # 主程式（全部業務邏輯）
├── requirements.txt    # Python 相依套件
├── Dockerfile          # Docker 容器設定
├── cloudbuild.yaml     # GCP Cloud Build CI/CD 流水線
├── .env.qa             # QA 環境變數
├── .env.prod           # 正式環境變數
├── CHANGELOG.md        # 版本變更紀錄（最新：prod-0.1.4）
└── .gitignore
```

## 核心功能流程

```
外部觸發 GET /gs_check
        ↓
呼叫後端 API → 取得所有遊戲伺服器清單
        ↓
並發建立 WebSocket 連線（asyncio）
        ↓
送出心跳指令 {"cmd":"checkIsLive","data":""}
        ↓
解析回應
  ├─ 異常（status.code != "0"）
  │   └─ Telegram 告警 + 寫入死亡 Log（status=1）
  └─ 正常（status.code == "0"）
      └─ 若前次為死亡 → 寫入復活 Log（status=0）
```

## 對外端點

| 路由 | 說明 |
|------|------|
| `GET /` | 健康檢查，回傳 `"ok"` |
| `GET /gs_check` | 觸發所有遊戲伺服器心跳測試 |

## 架構設計重點

### 1. 單一檔案架構

規模精簡，所有邏輯集中在 `app.py`，對於職責單一的微服務來說，這比拆分成多個模組更易於維護與部署。

### 2. Facade Pattern

API 類別統一封裝所有後端 REST 請求，內建錯誤處理與 Telegram 告警，呼叫端無需關心底層細節。

### 3. 多環境設定

透過環境變數 `BUILD_CONFIGURATION` 決定載入 `.env.qa` 或 `.env.prod`，同一份程式碼可無縫切換 QA 與正式環境。

### 4. 異步在同步環境中執行

Flask 本身是同步框架，透過 `asyncio.new_event_loop()` 在每次請求中建立新的事件迴圈，解決了在同步環境中執行 `async` 函式的問題，讓 WebSocket 並發連線得以實現。

### 5. 四層 WebSocket 例外捕捉

對每個伺服器連線依序捕捉以下例外，確保任一伺服器異常不影響其他伺服器的探測：

1. `InvalidURI` — URL 格式錯誤
2. `ConnectionClosedError` — 連線中斷
3. `ConnectionRefusedError` — 連線被拒
4. `Exception` — 其他未預期錯誤

## 套件備註

`requirements.txt` 中有三個套件目前未實際使用，屬於預留設計：

| 套件 | 用途推測 |
|------|----------|
| `mysql-connector-python` | 未來直連資料庫功能預留 |
| `python-dateutil` | 目前 datetime 直接用標準庫，可移除 |
| `google-cloud-secret-manager` | 未來取代 `.env` 檔案，改用 GCP Secret Manager |

## 總結

pk-gs-check 是一個職責單一、結構精簡的監控工具。透過 WebSocket 心跳探測遊戲伺服器的存活狀態，並整合 **Telegram 即時告警**與後端 **Log 記錄**，在伺服器異常時能第一時間通知，恢復後也會自動記錄復活事件，整體設計清晰，易於維護與擴展。
