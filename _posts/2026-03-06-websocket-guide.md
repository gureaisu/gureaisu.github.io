---
layout:       post
title:        "WebSocket 入門指南"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - WebSocket
    - Node.js
    - 網路協定
    - 入門筆記
---

> 初次接觸 WebSocket 的學習筆記，包含概念說明、實作範例與測試工具。

## 一、WebSocket 是什麼？

WebSocket 是一種**持續雙向通訊**的協定，讓客戶端與伺服器在建立一次連線後，雙方都可以**隨時主動傳送訊息**，不需要每次重新建立連線。

適合用於：
- 即時遊戲
- 聊天室
- 股票報價、即時通知
- 多人協作工具

---

## 二、與 HTTP 的差異

| | HTTP | WebSocket |
|---|---|---|
| 連線方式 | 每次請求都重新建立 | 一次連線、持續保持 |
| 通訊方向 | 單向（客戶端發起） | 雙向（任一方都可主動發送） |
| 即時性 | 低（需輪詢） | 高 |
| 協定 | `http://` / `https://` | `ws://` / `wss://` |
| 加密版本 | HTTPS | WSS（需 SSL 憑證） |

**比喻：**
- HTTP = 寄信（問一次、答一次、結束）
- WebSocket = 打電話（建立後持續溝通）

---

## 三、連線流程

```
1. 客戶端發起 HTTP Upgrade 請求
   GET ws://server:port
   Upgrade: websocket

2. 伺服器回應 101 Switching Protocols
   ✅ 連線建立

3. 雙向持續溝通
   客戶端 → 伺服器：發送訊息
   伺服器 → 客戶端：推送訊息（不需客戶端先問）

4. 任一方主動關閉連線
```

---

## 四、訊息格式

本專案使用 **JSON 格式** 傳遞訊息。

### 客戶端送出

```json
{
  "cmd": "指令名稱",
  "data": { "參數key": "參數value" }
}
```

### 伺服器回應

```json
{
  "cmd": "指令名稱",
  "status": { "code": "0", "msg": "" },
  "data": { "回傳資料" }
}
```

> `status.code = "0"` 代表成功，其他數值代表各種錯誤。

---

## 五、實作：SimpleServer（Node.js）

一個簡易的 WebSocket 伺服器，模擬遊戲伺服器的指令回應。

📁 原始碼：[server.js](/file/2026-03-06-websocket-guide/SimpleServer/server.js) ／ [package.json](/file/2026-03-06-websocket-guide/SimpleServer/package.json)

### 環境需求

- [Node.js](https://nodejs.org) v16 以上

### 安裝與啟動

下載 `server.js` 與 `package.json` 後，將兩個檔案放在同一個資料夾（例如 `SimpleServer/`），然後執行：

```bash
cd SimpleServer
npm install
node server.js
```

啟動後輸出：

```
✅ WebSocket Server 啟動，監聽 port 9001
   連線網址：ws://127.0.0.1:9001
```

### 支援指令

| 指令 | 說明 |
|---|---|
| `sschk` | 心跳，回應 `code:0` |
| `ln` | 登入，回傳 Mock 玩家資料 |
| `lbll` | 取得級別列表 |
| `lbrl` | 取得房間列表 |
| `lbsr` | 進入遊戲房 |
| `pwlby` | 返回大廳 |
| `usdis` | 主動登出並斷線 |
| `checkIsLive` | 後台心跳確認 |

### server.js 核心概念

```javascript
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 9001 });

wss.on('connection', (ws) => {

    ws.on('message', (raw) => {
        const msg = JSON.parse(raw);

        switch (msg.cmd) {
            case 'sschk':
                ws.send(JSON.stringify({ cmd: 'sschk', status: { code: '0' } }));
                break;
            // ... 其他指令
        }
    });

    ws.on('close', () => { console.log('連線關閉'); });
});
```

### 停止伺服器

在終端機按 **Ctrl + C**。

若遇到 `EADDRINUSE`（port 被佔用）：

```powershell
# Windows PowerShell
netstat -ano | findstr :9001
taskkill /PID <找到的PID> /F
```

---

## 六、實作：測試用前端（test.html）

直接雙擊開啟，不需要任何安裝，提供按鈕介面測試所有 WebSocket 指令。

📄 下載：[test.html](/file/2026-03-06-websocket-guide/test.html)

### 使用方式

1. 雙擊 `test.html` 用瀏覽器開啟
2. 點 **🔌 連線**（預設連 `ws://127.0.0.1:9001`）
3. 依序點按鈕測試各指令
4. 畫面下方即時顯示所有收發訊息

### 瀏覽器 Console 直接測試

```javascript
const ws = new WebSocket('ws://127.0.0.1:9001');

ws.onopen    = () => console.log('✅ 連線成功');
ws.onmessage = (e) => console.log('📩', JSON.parse(e.data));
ws.onclose   = () => console.log('❌ 連線關閉');

// 登入
ws.send(JSON.stringify({ cmd: 'ln', data: { account: 'test', key: 'test123' } }));

// 心跳（每 30 秒送一次，避免被踢線）
setInterval(() => ws.send(JSON.stringify({ cmd: 'sschk', data: '' })), 30000);
```

> ⚠️ 注意：需在一般網頁（如 google.com）的 DevTools Console 執行，
> 不可在 `chrome://` 頁面執行（CSP 限制）。
> 第一次貼上程式碼前需先輸入 `allow pasting` 解鎖。

### WebSocket 狀態碼

```javascript
ws.readyState === 0  // CONNECTING：連線中
ws.readyState === 1  // OPEN：已連線，可收發訊息
ws.readyState === 2  // CLOSING：關閉中
ws.readyState === 3  // CLOSED：已關閉
```

---

## 七、常用狀態碼

本專案伺服器回傳的業務狀態碼：

| Code | 說明 |
|---|---|
| `0` | 成功 |
| `1001` | 系統即將維護，通知玩家 |
| `1002` | 系統維護，強制斷線 |
| `1011` | 心跳逾時，自動斷線（需定期送 `sschk`） |
| `2000` | 登入失敗 |
| `2001` | 帳號不存在 |
| `2002` | 密碼錯誤 |
| `2009` | 帳號重複登入 |
| `3200` | 入房失敗 |
| `3202` | 房間不存在 |
| `3210` | 房間人數已滿 |

---

## 八、常見問題

### Q：連線時出現 `ECONNREFUSED`

伺服器尚未啟動，或 port 錯誤。確認伺服器已執行並監聽對應 port。

```powershell
netstat -ano | findstr :9001
```

### Q：連線後自動斷線（code: 1011）

超過 90 秒沒有送心跳，伺服器自動踢除。需定期送 `sschk`：

```javascript
setInterval(() => ws.send(JSON.stringify({ cmd: 'sschk', data: '' })), 30000);
```

### Q：Chrome DevTools Console 出現 CSP 錯誤

不要在 `chrome://newtab` 或空白頁執行，改到任意一般網頁（如 google.com）再開 DevTools。

### Q：從外部主機連線

確認防火牆已開放 port：

```powershell
netsh advfirewall firewall add rule `
  name="WebSocket Port 9001" `
  dir=in action=allow protocol=TCP localport=9001
```

### Q：想使用加密連線（WSS）

需要 SSL 憑證（`.pfx` 格式），連線網址改為 `wss://`。

---

## 參考資源

- [MDN WebSocket API](https://developer.mozilla.org/zh-TW/docs/Web/API/WebSocket)
- [ws - Node.js WebSocket library](https://github.com/websockets/ws)
- [RFC 6455 - WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455)
