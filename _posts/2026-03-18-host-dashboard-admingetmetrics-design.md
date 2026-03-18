---
layout:       post
title:        "XPG Game Server — Host HTML 儀表板與 AdminGetMetrics 設計"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - C#
    - Game Server
    - WebSocket
    - 監控
    - 系統設計
---

> 目標：補足 Linux（Console）模式下沒有 WinForms 視窗的監控能力，  
> 透過 WebSocket + Admin 指令提供一個 Web 版監控儀表板。

## 1. 問題背景

- Windows 模式下，`FormMain` 負責顯示：
  - 目前連線數
  - 大廳總人數（真人 / NPC）
  - 房內遊戲人數
  - 房間總數
  - NPC 等候池狀態
  - Rocket 彩池
  - Log 列表
- Linux 模式下改為 `ConsoleView`，上述資訊都仍然存在於記憶體中，但**沒有 UI 介面可視覺化顯示**。

**目標**：新增一組 Admin API + Host HTML 網頁，達成「用瀏覽器看到伺服器即時狀態」的效果。

---

## 2. AdminGetMetrics 指令設計

### 2.1 命令名稱

在 `ServerCommand.cs` 新增一個管理者命令常數：

```csharp
public const string AdminGetMetrics = "getMetrics";
```

### 2.2 回傳格式

沿用現有 Admin 指令的封包格式：

```json
{
  "cmd": "getMetrics",
  "traceCode": "",
  "status": {
    "code": "0",
    "message": "",
    "datetime": "2026-03-17T12:00:00.000+08:00"
  },
  "data": {
    "connections": 42,
    "totalPlayers": 38,
    "npcCount": 5,
    "npcWaitLimit": 10,
    "npcWaitCount": 2,
    "roomsPlayerCount": 12,
    "roomsPlayerNpcs": 1,
    "roomCount": 8,
    "prizePool": 15000,
    "serverTime": "2026-03-17T12:00:00.000+08:00"
  }
}
```

### 2.3 回傳資料結構（C#）

在 `GameController.CmdAdmin.cs` 的共用結構區新增：

```csharp
public class CmdAdmin_Metrics_Send : CmdDataObject
{
    public int connections;
    public int totalPlayers;
    public int npcCount;
    public int npcWaitLimit;
    public int npcWaitCount;
    public int roomsPlayerCount;
    public int roomsPlayerNpcs;
    public int roomCount;
    public decimal prizePool;
    public string serverTime;
}
```

### 2.4 Admin 分支註冊

在 `GameController.CmdAdmin.cs` 的 `onReceiveFromAdmin` 中加入：

```csharp
case ServerCommand.AdminGetMetrics:
    rcvAdminGetMetrics(sn, data, traceCode);
    return true;
```

### 2.5 指令實作（概念）

在 `GameController.CmdAdmin.cs` 新增：

```csharp
private void rcvAdminGetMetrics(String sn, String data, String traceCode)
{
    int roomsTotal = 0;
    int roomsNpcs  = 0;

    foreach (Player p in UserManager.One.GetAllUsers())
    {
        if (p.RoomNo > 0)
        {
            roomsTotal++;
            if (p is NpcPlayer) roomsNpcs++;
        }
    }

    decimal prizePool = 0;
    ContentLobbyAdapter rocket = GetLobbyAdapter("2");
    if (rocket is CECom.Content.Rocket.RocketLobbyAdapter rla)
        prizePool = rla.GetTotalPrizePool();

    var metrics = new CmdAdmin_Metrics_Send
    {
        connections      = this.m_nowConnections,
        totalPlayers     = UserManager.One.GetTotalCount(),
        npcCount         = this.m_npcMgr.Count,
        npcWaitLimit     = GameSetting.System.NpcWait_Limit,
        npcWaitCount     = this.m_npcLobby.Count,
        roomsPlayerCount = roomsTotal,
        roomsPlayerNpcs  = roomsNpcs,
        roomCount        = RoomManager.One.GetRoomCount(),
        prizePool        = prizePool,
        serverTime       = ToRfc3339String()
    };

    NotifyByAdmin(
        sn,
        ServerCommand.AdminGetMetrics,
        traceCode,
        new CmdAdmin_StatusInfo_Send(AdminReasonCode.Success, "", ToRfc3339String()),
        metrics
    );
}
```

> 註：是否要檢查 IP 白名單（`checkAdminVaild`）可以依實際需求決定；  
> 若只在內網使用 Host 儀表板，可先不啟用白名單，或僅在正式環境開啟。

### 2.6 Rocket 彩池總額（可選）

若要在儀表板顯示 Rocket 彩池總額，可在 `Content/Rocket/RocketLobbyAdapter.cs` 加一個查詢方法：

```csharp
public decimal GetTotalPrizePool()
{
    decimal sum = 0;
    foreach (decimal v in m_prizePools.Values)
        sum += v;
    return sum;
}
```

若暫時不需要顯示彩池，可先讓 `prizePool` 固定為 `0`，日後再補。

---

## 3. Host HTML 儀表板設計

### 3.1 角色與用途

- 檔案建議位置：`temp/GuessSongHost.html`
- 角色：**伺服器監控客戶端**（Host / Admin 用），非遊戲玩家
- 功能：
  - 連線 / 斷線到遊戲伺服器 WebSocket 埠
  - 定期（例如每 3～5 秒）送出 `getMetrics` 指令
  - 將回傳的各項指標顯示在網頁上，達成類似 WinForms `FormMain` 的監控效果

### 3.2 顯示欄位

對應 `CmdAdmin_Metrics_Send` 的欄位，建議在頁面上顯示：

- **連線**：
  - 目前連線數：`connections`
- **大廳 / 玩家**：
  - 大廳總人數（含 NPC）：`totalPlayers`
  - NPC 數量：`npcCount`
- **NPC 等候池**：
  - 等候池上限：`npcWaitLimit`
  - 等候池目前人數：`npcWaitCount`
- **房間 / 房內人數**：
  - 房內遊戲人數總數：`roomsPlayerCount`
  - 房內 NPC 人數：`roomsPlayerNpcs`
  - 房間總數：`roomCount`
- **彩池（選擇性）**：
  - Rocket 彩池總額：`prizePool`
- **其他**：
  - 伺服器時間：`serverTime`

### 3.3 前端流程

1. 使用者在頁面上輸入 WebSocket URL，例如 `ws://127.0.0.1:10001`
2. 按「連線」：
   - 建立 `new WebSocket(url)`
   - `onopen` 事件中：
     - 將狀態設為「已連線」
     - 啟動一個 `setInterval` 每 N 秒呼叫 `requestMetrics()`
3. `requestMetrics()` 內容：

```javascript
function requestMetrics() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ cmd: 'getMetrics', data: '' }));
}
```

4. 在 `ws.onmessage` 中：
   - `JSON.parse(e.data)`
   - 若 `msg.cmd === 'getMetrics' && msg.status?.code === '0'`：
     - 呼叫 `updateDashboard(msg.data)` 將各欄位渲染到畫面
5. `updateDashboard(data)` 將 `data.connections` 等數值填入對應的 `<div>` / `<span>`
6. `onclose` / `onerror`：
   - 將狀態設為「未連線」
   - `clearInterval` 停止輪詢
7. 按「斷線」按鈕：
   - 呼叫 `ws.close()`

### 3.4 UI 建議

- 可直接複用 `temp/GuessSongTest.html` 的：
  - 深色主題 CSS
  - `.section`、`.btn-*`、Log 區塊樣式
- 差異只在於：
  - 左側：只保留「連線」區塊（輸入 URL、連線 / 斷線）
  - 右側：改為多個小卡片顯示監控指標，例如：
    - 「目前連線數」
    - 「大廳人數（真人 / NPC）」 
    - 「房內人數 / 房間數」
    - 「彩池」
    - 「伺服器時間」
  - 最底可加一個簡易 Log 區，顯示最近幾次輪詢結果或錯誤訊息

### 3.5 權限與安全性

- **IP 白名單**（選擇性）：
  - 可在 `rcvAdminGetMetrics` 開頭加入：
    - 透過 `m_connServer.GetClientIP(sn)` 取得連線 IP
    - 使用 `checkAdminVaild` 檢查是否在 `GameSetting.System.Admin_AllowIpList` 中
  - 若不合法：
    - 可直接 `return` 或回傳 `AdminReasonCode.NoAuthority`
- **建議策略**：
  - 開發 / 測試環境：可不檢查 IP，簡化流程
  - 正式環境：應限制只有管理後台或監控機可以呼叫 `getMetrics`

---

## 4. 實作順序建議

1. **ServerCommand.cs**：新增 `AdminGetMetrics` 常數
2. **GameController.CmdAdmin.cs**：
   - 新增 `CmdAdmin_Metrics_Send` 類別
   - 在 `onReceiveFromAdmin` `switch` 中加入 `AdminGetMetrics` 分支
   - 新增 `rcvAdminGetMetrics` 方法，收集各項數據
3. （可選）**RocketLobbyAdapter.cs**：新增 `GetTotalPrizePool()` 供查詢彩池總額
4. 使用簡單 WebSocket 工具測試：
   - 送出 `{ "cmd": "getMetrics", "data": "" }`
   - 確認伺服器回傳 JSON 結構正確
5. 新增 `temp/GuessSongHost.html`：
   - 實作連線 / 斷線
   - 每 3～5 秒送一次 `getMetrics`
   - 將回傳數據更新到畫面上的各指標卡片
6. 在 Windows 與 Linux 環境皆測試：
   - 伺服器啟動後，開啟 Host HTML
   - 驗證指標會隨實際連線 / 玩家 / 房間變化

---

## 5. 小結

- **AdminGetMetrics** 提供一個統一的監控資料來源，未來可被：
  - Host HTML 儀表板（本文件）
  - 外部監控系統（如 Prometheus Exporter）重用
- **Host HTML 儀表板** 是針對「Linux 無 WinForms 視窗」的補強方案，  
  即使在 Windows 版也可以使用，方便遠端查看伺服器狀態
