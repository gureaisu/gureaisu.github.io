---
layout:       post
title:        "GameServer 系統架構說明"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - C#
    - WebSocket
    - Nginx
    - Google Cloud
    - Game Server
    - 架構設計
---

> 本文件描述遊戲伺服器系統的整體架構、元件關係與資料流。

## 一、整體架構概覽

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                             │
└──────────┬──────────────────────┬───────────────────────────┘
           │                      │
           ▼                      ▼
    ┌─────────────┐        ┌─────────────────────┐
    │  玩家 App   │        │  GCP Cloud Scheduler │
    │  (Client)  │        │  每分鐘觸發 gs_check  │
    └──────┬──────┘        └──────────┬───────────┘
           │                          │
           │ 1. 先呼叫後端 API         │ HTTPS GET /gs_check
           │    取得分配的 GS URL      │
           ▼                          ▼
    ┌─────────────────────┐
    │    後端 REST API     │
    │  計算分配到哪台 GS   │
    │  回傳 wss:// URL    │
    └──────┬──────────────┘
           │
           │ 2. 用回傳 URL 建立 WebSocket
           ▼
┌──────────────────────────────────────────────────────────┐
│                  GCP / lb-nginx                          │
│                                                          │
│   Nginx 1.26.3 (Ubuntu)                                  │
│   ┌──────────────────────────────────────────────────┐   │
│   │  gs.conf                                         │   │
│   │  server_name: pk-gs-qa.ceis.tw                  │   │
│   │  listen: 443 ssl / 10001 ssl                    │   │
│   │  proxy_pass: http://10.148.0.2:10001            │   │
│   ├──────────────────────────────────────────────────┤   │
│   │  gs2.conf                                        │   │
│   │  server_name: pk-gs2-qa.ceis.tw                 │   │
│   │  listen: 443 ssl / 10001 ssl                    │   │
│   │  proxy_pass: http://10.148.0.6:10001            │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
│   SSL 憑證: /etc/nginx/conf.d/ssl/ceis-tw.pem           │
└──────────┬────────────────────┬─────────────────────────┘
           │ ws://內網           │ ws://內網
           ▼                    ▼
  ┌────────────────┐   ┌────────────────┐
  │  GCP Windows   │   │  GCP Windows   │
  │  VM - GS:1     │   │  VM - GS:2     │
  │  10.148.0.2    │   │  10.148.0.6    │
  │  :10001        │   │  :10001        │
  │  XpgServer.exe │   │  XpgServer.exe │
  └────────────────┘   └────────────────┘
           │                    │
           └─────────┬──────────┘
                     │ HTTP REST API
                     ▼
          ┌──────────────────────┐
          │   後端 REST API       │
          │  ga-qa.pk.ceis.tw    │  ← 玩家登入驗證
          │  wallet-qa.pk.ceis.tw│  ← 錢包餘額/儲值
          └──────────────────────┘
```

---

## 二、元件說明

### 2.1 Game Server（XpgServer.exe）

- **語言/框架**：C# / .NET 8.0 / Windows Forms
- **通訊協定**：WebSocket（明文）/ WSS（SSL，由 Nginx 終止）
- **主循環**：100ms Timer，單執行緒處理所有遊戲邏輯
- **網路層**：自建 CeEngine，使用 Windows IOCP 非同步架構
- **目前遊戲**：火箭（Rocket）、麻將（Mahjong）、踩地雷（Minesweeper）

| 元件 | 說明 |
|---|---|
| `GameController` | 系統核心，處理連線、命令路由、玩家管理 |
| `RoomManager` | 管理所有遊戲房間（Singleton） |
| `UserManager` | 管理所有在線玩家（Singleton） |
| `ContentLobbyAdapter` | 各遊戲的大廳介接器 |
| `DBXpgApi` | 正式環境 HTTP API 對接 |
| `DBTester` | 本機測試 Mock（SystemRunMode=0） |

### 2.2 Nginx（lb-nginx）

- **版本**：nginx/1.26.3 (Ubuntu)
- **角色**：SSL 終止 + WebSocket 反向代理
- **設定位置**：`/etc/nginx/conf.d/`

| 設定檔 | 對應 Server | 內網目標 |
|---|---|---|
| `gs.conf` | pk-gs-qa.ceis.tw | 10.148.0.2:10001 |
| `gs2.conf` | pk-gs2-qa.ceis.tw | 10.148.0.6:10001 |

### 2.3 監控服務（app.py）

- **執行環境**：GCP Cloud Run
- **觸發方式**：GCP Cloud Scheduler，每分鐘執行一次（`* * * * *`）
- **服務網址**：`https://pk-gs-check-*.asia-southeast1.run.app`
- **版本**：`prod-0.1.4`
- **通知方式**：Telegram Bot

### 2.4 後端 REST API

| 服務 | 網址 | 用途 |
|---|---|---|
| Game API | ga-qa.pk.ceis.tw | 玩家登入/登出、將號、報表 |
| Wallet API | wallet-qa.pk.ceis.tw | 餘額查詢、儲值、提款 |

---

## 三、連線流程

### 3.1 玩家連線流程

```
1. 玩家 App 向後端 REST API 請求登入
   後端 API 進行身份驗證，並計算分配到哪台 GS
   （依各台負載、isDead 狀態等條件決定）

2. 後端 API 回傳指定的 GS WebSocket 網址
   回傳：{ "gsUrl": "wss://pk-gs-qa.ceis.tw", ... }

3. 玩家 App 用回傳的網址建立 WebSocket 連線
   wss://pk-gs-qa.ceis.tw
       ↓ lb-nginx SSL 終止
   ws://10.148.0.2:10001（GS:1 內網）

4. 玩家送出登入指令
   {"cmd":"ln","data":{"account":"xxx","key":"yyy"}}

5. GS 向後端 API 驗證帳號，成功後回傳玩家資料

6. 玩家進入大廳，取得房間列表並進房遊戲
```

### 3.2 訊息格式

**送出（Client → Server）：**

```json
{ "cmd": "指令名稱", "data": { "參數": "值" } }
```

**收到（Server → Client）：**

```json
{ "cmd": "指令名稱", "status": { "code": "0", "msg": "" }, "data": { "回傳資料" } }
```

### 3.3 常用指令

| 指令 | 方向 | 說明 |
|---|---|---|
| `sschk` | ↑↓ | 心跳（90 秒內需送一次，否則被踢） |
| `ln` | ↑↓ | 玩家登入 |
| `lbll` | ↑↓ | 取得級別列表 |
| `lbrl` | ↑↓ | 取得房間列表 |
| `lbsr` | ↑↓ | 進入遊戲房 |
| `pwlby` | ↑↓ | 返回大廳 |
| `usdis` | ↑ | 玩家主動登出 |
| `ssdis` | ↓ | 系統主動斷線（含錯誤碼） |

---

## 四、監控機制

### 4.1 監控流程

```
每分鐘
  Cloud Scheduler → GET /gs_check（Cloud Run）
       ↓
  1. GET /GameServer/Get  → 取得所有 GS 清單
       ↓
  2. 逐一建立 WebSocket 連線
     wss://pk-gs-qa.ceis.tw
     wss://pk-gs2-qa.ceis.tw
       ↓
  3. 送出心跳指令
     {"cmd":"sschk","data":""}
       ↓
     ┌─────────────┬──────────────────┐
     │ 回應 code=0  │  連線失敗/錯誤碼  │
     └──────┬──────┴────────┬─────────┘
            ▼               ▼
       比對今日 Log      Telegram 警報
       有死亡記錄？      POST /GameServer/LogAdd
       → 寫入復活記錄    status=1（死亡）
```

### 4.2 Log 狀態說明

| status | 意思 |
|---|---|
| `0` | 復活（從死亡恢復正常） |
| `1` | 死亡（連線失敗） |

### 4.3 Telegram 通知時機

| 事件 | 通知內容 |
|---|---|
| GS 連線失敗 | 環境、URL、錯誤訊息 |
| GS 回應異常碼 | 環境、URL、回應內容 |
| API 呼叫失敗 | 環境、API 路徑、錯誤訊息 |

---

## 五、多台 Game Server 擴展

### 5.1 擴展原則

- 同一個房間的所有玩家**必須在同一台 GS**
- 各台 GS 之間完全獨立，不共享記憶體
- 後端 API 負責記錄哪個房間在哪台 GS
- Nginx 以**子網域**區分各台 GS（不做 Round Robin）

### 5.2 新增一台 GS 的步驟

```
1. 建立新的 GCP Windows VM
2. 部署 XpgServer.exe，設定 ServerName=GS:3
3. 新增 Nginx 設定：/etc/nginx/conf.d/gs3.conf
4. sudo nginx -t && sudo systemctl reload nginx
5. 後端 API 的 GameServer 資料表新增一筆記錄
   { url: "wss://pk-gs3-qa.ceis.tw", isDead: 0 }
6. 監控服務（app.py）自動納入，不需修改
```

### 5.3 建議擴展時機

| 情況 | 建議 |
|---|---|
| 單台 CPU < 70% | 維持現狀 |
| 單台 CPU 持續 > 80% | 準備加台 |
| 假日 / 活動高峰 | 提前加台，活動後關閉 |
| GS 掛掉 | 立即加台分流，修復後再縮回 |

---

## 六、部署流程

### 6.1 Game Server（Windows VM）

```
1. 編譯：Visual Studio → Build → Release
2. 複製到 VM：XpgServer.exe + _setting/ 資料夾
3. 執行 XpgServer.exe
4. 確認 WinForm Console 顯示啟動完成
5. 用 Postman / test.html 確認 WebSocket 可連線
```

### 6.2 監控服務 app.py（Cloud Run）

```
1. 修改 app.py
2. git add app.py && git commit && git push
3. Cloud Build 自動觸發（cloudbuild.yaml）
4. Build Docker Image → Push to Artifact Registry
5. Deploy to Cloud Run (pk-gs-check)
6. 確認 Cloud Run Log 正常執行
```

**Cloud Build 關鍵設定：**

| 變數 | 值 |
|---|---|
| `_SERVICE_NAME` | pk-gs-check |
| `_DEPLOY_REGION` | asia-southeast1 |
| `_ENV` | qa |

---

## 七、設定檔說明

### 7.1 Game Server - `_setting/_Config.json`

啟動時讀取，**不可熱更新**。

```json
{
  "ServerName": "GS:1",
  "ServerPort": 10001,
  "LinkType": 1,
  "RunContents": "1-2:Rocket",
  "SystemRunMode": 9,
  "DB_ConnString": "https://ga-qa.pk.ceis.tw/",
  "Wallet_ConnString": "https://wallet-qa.pk.ceis.tw/",
  "SystemCheck_Timeout": 90,
  "SysSD_Step1_Sec": 300,
  "SysSD_Step2_Sec": 180,
  "SysSD_Step3_Sec": 120
}
```

> `LinkType`：1 = WS（明文），2 = WSS（SSL）
> `SystemRunMode`：0 = 測試模式，9 = 正式 XPG API

### 7.2 Game Server - `_setting/_System.json`

**可熱更新**，點「重置系統設定」後生效。

```json
{
  "MaintainSetWeek": -1,
  "ZombieConnectionCheck": 30,
  "ZombieConnectionTimeout": 300,
  "NpcWait_Limit": 0,
  "Admin_AllowIPs": "34.92.234.4"
}
```

> ⚠️ `Admin_AllowIPs` 需包含所有需要發送 Admin 指令的來源 IP。
> Cloud Run 使用動態 IP，建議監控改用 `sschk` 指令。

### 7.3 app.py 環境變數（`.env.qa`）

| 變數 | 說明 |
|---|---|
| `BOT_TOKEN` | Telegram Bot Token |
| `CHAT_ID` | Telegram 通知群組 ID |
| `API_URL` | 後端 REST API 根網址 |

---

## 附錄：常見問題

| 問題 | 原因 | 解法 |
|---|---|---|
| Postman 連線 ECONNREFUSED | GS 未啟動或啟動失敗 | 查看 WinForm Console 訊息 |
| 登入失敗 code:2000 | 帳密錯誤或 API 連不上 | 確認 SystemRunMode 設定 |
| 心跳逾時 code:1011 | 90 秒內未送 sschk | 定期送心跳 |
| Telegram 不定期誤報 | checkIsLive IP 白名單問題 | 改用 sschk 指令 |
| GS 啟動失敗 Action File 不存在 | bin/Debug 缺少設定檔 | 複製 _setting/ 到 bin/Debug |
| Nginx 警告 http2 deprecated | nginx 1.26 新寫法 | listen 改為獨立 http2 on |
