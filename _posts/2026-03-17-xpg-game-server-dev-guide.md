---
layout:       post
title:        "XPG Game Server — 開發人員指南"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - C#
    - Game Server
    - WebSocket
    - 開發指南
---

> 適用對象：初次接觸本專案的開發人員。  
> 以「猜歌遊戲（GuessSong）」為實作範例，說明如何從零開始理解、維護與新增遊戲。

## 1. 專案概覽

### 技術棧

| 項目 | 技術 |
|------|------|
| 語言 | C# (.NET 8.0) |
| UI | Windows Forms（管理介面） |
| 通訊 | WebSocket / WSS（`ConnectionAdapter`） |
| 後台 API | HTTP/HTTPS REST（`WebAccess` + `DBXpgApi`） |
| Log | NLog（設定於 `NLog.json`） |
| JSON 序列化 | Newtonsoft.Json |
| 設定格式 | JSON（`_Config.json`、`_System.json`）、XML（各遊戲 Content） |

### 架構概念

伺服器以「**Content**」為遊戲的最小運行單位。每一種遊戲（如 Rocket、GuessSong）是一個 Content，由一個 `ContentLobbyAdapter`（大廳介接器）管理。  
玩家連線後，透過 WebSocket 命令在「大廳」與「遊戲房」之間流動。

```
Client (Browser / App)
       │  WebSocket
       ▼
ConnectionAdapter
       │
GameController          ← 神經中樞（命令路由、計時驅動）
       │
       ├── RocketLobbyAdapter      ← Content: 火箭
       │       └── Rocket Room × N
       │
       └── GuessSongLobbyAdapter   ← Content: 猜歌
               └── GuessSong Room × N
```

---

## 2. 環境建置

### 必要條件

- Visual Studio 2022（建議）或 Rider
- .NET 8.0 SDK
- Windows 作業系統（因使用 Windows Forms）

### 執行前設定

伺服器啟動時讀取**執行目錄**下的 `_setting/` 資料夾。Debug 模式的執行目錄為：

```
GameServer\bin\Debug\net8.0-windows7.0\
```

請確認以下檔案已存在於該目錄下的 `_setting/` 資料夾：

```
_setting/
├── _Config.json                          ← 必要（伺服器主設定）
├── _System.json                          ← 必要（系統參數）
├── NLog.json                             ← 必要（Log 設定）
├── content/
│   ├── 1002_GuessSong.xml                ← GuessSong Content 結構
│   └── 1002_GuessSong_TimeSetting.json   ← GuessSong 場景時間
└── mock/
    └── GuessSong_Songs.json              ← 題庫（965 首台灣熱門歌曲）
```

### `_Config.json` 最小設定（本機開發）

```json
{
  "ServerName":        "GuessSong_Dev",
  "ServerPort":        10001,
  "LinkType":          1,
  "LinkCustomInfo":    "123456",
  "RunContents":       "1001-1002:GuessSong",
  "SystemRunMode":     0,
  "DB_ConnString":     "https://ga-qa.pk.ceis.tw/",
  "Wallet_ConnString": "https://wallet-qa.pk.ceis.tw/",
  "IsIntegerSystem":   true,
  "SystemCheck_Notify":  0,
  "SystemCheck_Timeout": 90,
  "SysSD_Step1_Sec":   300,
  "SysSD_Step2_Sec":   180,
  "SysSD_Step3_Sec":   120
}
```

> `SystemRunMode: 0` = 使用本機模擬 DB（`DBTester`），無需連接真實後台。

### `RunContents` 格式說明

```
格式：<gameId>-<contentId>:<contentName>
範例："1-2:Rocket,1001-1002:GuessSong"
```

| 欄位 | 說明 |
|------|------|
| `gameId` | 遊戲在後台的代號（字串整數） |
| `contentId` | Content 唯一 ID，作為 Adapter 的 Key，也是設定檔的前綴 |
| `contentName` | 程式內對應 `switch(cname)` 的字串，**大小寫必須完全一致** |

---

## 3. 專案目錄結構

```
code/
├── XPG_Server.sln
├── GameServer/
│   ├── Program.cs                      ← 應用程式進入點、全域 Log
│   ├── GameSetting.cs                  ← 設定檔載入（Config / System）
│   ├── GameController.cs               ← 核心控制器（WebSocket 事件入口）
│   ├── GameController.MainProcess.cs   ← 初始化流程、主計時器
│   ├── GameController._Customize.cs    ← 遊戲 Content 登錄（★ 新增遊戲必改）
│   ├── GameController.CmdCommon.cs     ← 命令路由邏輯
│   ├── ContentLobbyAdapter.cs          ← 大廳介接器抽象基底類別
│   ├── MultiGame.cs                    ← 遊戲房抽象基底類別
│   ├── ServerCommand.cs                ← 全域 WebSocket 命令常數
│   ├── _ContentInfo.cs                 ← ContentInfo / Level / Room 結構
│   │
│   ├── CeEngine/                       ← 底層引擎（連線、玩家、房間管理）
│   │   ├── ConnectionAdapter.cs        ← WebSocket 伺服器
│   │   ├── Player.cs                   ← 玩家物件
│   │   ├── UserManager.cs              ← 玩家 Singleton 管理器
│   │   ├── RoomManager.cs              ← 房間 Singleton 管理器
│   │   └── Game/
│   │       ├── Game.cs                 ← 基礎遊戲類別
│   │       ├── GameRoom.cs             ← 遊戲房基礎
│   │       └── GameUser.cs             ← 遊戲用戶基礎
│   │
│   ├── DB/                             ← 資料庫抽象層
│   │   ├── IDbProvider.cs              ← DB 操作介面
│   │   ├── ManagerDB.cs                ← DB 工廠（依 SystemRunMode 選擇實作）
│   │   ├── DBTester.cs                 ← 本機模擬 DB（SystemRunMode=0）
│   │   └── DBXpgApi.cs                 ← 正式 REST API（SystemRunMode=9）
│   │
│   └── Content/                        ← ★ 各遊戲實作位置
│       ├── Rocket/                     ← 現有遊戲（可作為參考範本）
│       │
│       └── GuessSong/                  ← 猜歌遊戲（本文件說明對象）
│           ├── _GameStruct.cs          ← DTO、命令常數、場景索引
│           ├── GuessSong.cs            ← 遊戲房主體（玩家、分數、結算）
│           ├── GuessSong.Stage.cs      ← 場景狀態機
│           ├── GuessSong.Command.cs    ← 玩家命令處理
│           ├── GuessSongLobbyAdapter.cs
│           ├── GuessSongLobbyAdapter.BgLine.cs
│           └── GuessSongLobbyAdapter.Report.cs
│
├── _setting/                           ← 原始設定檔（需同步至 bin/_setting/）
│   ├── content/
│   └── mock/
│
└── temp/
    └── GuessSongTest.html              ← 本機 WebSocket 測試工具
```

---

## 4. 核心架構說明

### 4.1 `Program.cs` — 進入點與全域 Log

```csharp
static class Program
{
    public static FormMain       MainView   { get; }
    public static GameController Controller { get; }

    public static void LogTrace(String msg, Boolean showScreen = false)
    public static void LogInfo(String msg, Boolean showScreen = false)
    public static void LogWarn(String msg, Boolean showScreen = false)
    public static void LogError(String msg, Boolean showScreen = false)
    public static void ShowToForm(string msg)
}
```

> **重要**：`LogXxx()` 需要 NLog 已初始化（`RunNLog()` 執行後）。  
> `ShowToForm()` 不需要，可在啟動初期安全呼叫。

### 4.2 `GameSetting.cs` — 設定管理

| 屬性 | 對應檔案 | 是否可熱更新 |
|------|----------|------------|
| `Config` | `_Config.json` | 否（需重啟） |
| `System` | `_System.json` | 是（`ResetSystemInfo()`） |

### 4.3 `ContentLobbyAdapter.cs` — 大廳介接器（抽象）

**每種遊戲必須繼承此類別**，並實作以下方法：

```csharp
public abstract class ContentLobbyAdapter
{
    ContentInfo InitContent()
    void EndContent()
    bool ResetSettingProfile(int setId, Object paras)
    void UserDisconnect(Player player, String data)
    void SyncSystemTime()                               // ★ 每 100ms 由主計時器驅動
    void GetLevelList(Player player, String data)
    void GetRoomList(Player player, String data)
    void DoSelectRoom(Player player, String data)
    bool DoCustomCommand(Player player, String cmd, String data)  // ★ 自訂命令路由
    bool WriteSequenceReport(DbPara_SequenceReport report)
    bool WriteInningReport(DbPara_InningReport report)
    int  WriteMemberReport(DbPara_MemberReport report, Decimal finalMoney)
}
```

### 4.4 `MultiGame.cs` — 遊戲房（抽象）

```csharp
public abstract class MultiGame : GameRoom
{
    void SyncSystemTime()                                          // ★ 每 100ms 計時驅動
    bool ReceiveFromPlayer(Player player, String cmd, String data)
    void GetEnterRoomInfo(Player player)
    void ReturnLobby(Player player)
    int  PlayerDisconnect(Player player, Boolean forceToLeave)
    int  PlayerLinkRoom(Player player)

    // 玩家管理（已實作）
    void AddMultiPlayer(Player player)
    Player RemoveMultiPlayer(int memberId)
    Player GetMultiPlayer(int memberId)
    Player[] GetMultiUserList()

    // 廣播（已實作）
    void NotifyPlayer(Player player, String cmd, CmdDataObject datas)
    void NotifyAll(String cmd, CmdDataObject datas)
    void NotifyAll(String cmd, CmdDataObject datas, int excludeMID)
}
```

### 4.5 命令路由優先順序

```
1. Admin 命令（管理後台）
2. 系統命令（ln、sschk、lbll、lbrl、lbsr 等）
3. ★ 遊戲房命令（玩家已在房間時）
      → player.ContentID != "" && player.RoomNo > 0
      → room.ReceiveFromPlayer(player, cmd, data)
4. ★ 客製化大廳命令（data 中含 "contentId"）
      → m_lobbyAdapter[contentId].DoCustomCommand(player, cmd, data)
```

> **關鍵**：步驟 4 的客製化命令（如 `gscr`、`gsjr`），**必須在 data JSON 中帶入 `contentId`**，否則命令會被靜默丟棄。

---

## 5. 系統啟動流程

```
Application.Run(FormMain)
│
└── FormMain.FormMain_Shown()
        │
        ├── GameSetting.Initialize(AppPath)       ← 載入 _Config.json / _System.json
        │
        └── GameController.StartSystem()
                │
                ├── [1] Program.RunNLog()          ← 初始化 NLog
                │
                ├── [2] onInitial()
                │       ├── WebAccess.Initialization()
                │       ├── ManagerDB.Inst.CheckConnection()
                │       └── initialContents()      ← ★ 依 RunContents 建立各遊戲 Adapter
                │               ├── new GuessSongLobbyAdapter(...)
                │               ├── adapter.InitContent()
                │               │       ├── loadTimeSetting()
                │               │       └── loadSongPool()
                │               ├── m_lobbyAdapter.Add(contentId, adapter)
                │               └── GameSetting.AddContent(contentInfo)
                │
                └── [3] ConnectionAdapter.RunOneWsServer(port)
                        └── OnServerStarted()
                                └── m_mainTimer.Start()  ← 每 100ms 執行主循環
```

### 主循環（每 100ms）

```
syncTimesForGame()
├── 消耗 m_cmdQueue 中的命令 → onReceiveFromUser()
├── 所有 LobbyAdapter.SyncSystemTime()     ← GuessSong: 廣播等待室、清理房間
└── 所有 MultiGame.SyncSystemTime()        ← GuessSong: 場景狀態機計時推進
```

---

## 6. WebSocket 命令路由

### 通訊協定格式

```json
{ "cmd": "gscr", "data": { "contentId": "1002", "roomMode": 2, "roundCount": 5 } }
```

### GuessSong 完整命令表

| 命令 | 方向 | 說明 | 必要欄位 |
|------|------|------|---------|
| `gscr` | C→S | 創建猜歌房 | `contentId`, `roomMode`, `scoreMode`, `roundCount`, `roundTimeSec` |
| `gscr` | S→C | 創房結果 | `code`(0=成功), `roomCode`, `teams?` |
| `gsjr` | C→S | 加入房間 | `contentId`, `roomCode`, `nickname`, `teamIndex?` |
| `gsjr` | S→C | 加入結果 | `code`(0=成功), `assignedTeam`, `teamName` |
| `gsgi` | S→C | 房間完整資訊（進房推送） | `roomMode`, `scoreMode`, `roundCount`, `teams?` |
| `gsts` | S→C | 等待室隊伍人數（每 3s 廣播） | `total`, `teams?` |
| `gsst` | C→S | 房主開始遊戲 | — |
| `gsq` | S→C | 推送題目 | `round`, `totalRounds`, `artistName`, `chars[]`, `timeSec` |
| `gsa` | C→S | 提交答案 | `round`, `answer` |
| `gsa` | S→C | 提交結果 | `code`(0=成功), `isCorrect` |
| `gsrr` | S→C | 本輪結果 | `round`, `answer`, `rankings[]` |
| `gsfr` | S→C | 最終結算 | `rankings[]`, `teams?` |

### 標準系統命令

| 命令 | 說明 |
|------|------|
| `sschk` | 心跳（每 30 秒送一次，防止斷線） |
| `ln` | 登入（`{ account, key }`） |
| `lbll` | 取得級別列表 |
| `lbrl` | 取得房間列表 |
| `gori` | 取得當前房間資訊（進房後任意時間可呼叫） |
| `pwlby` | 返回大廳 |

---

## 7. 新增遊戲完整步驟（以 GuessSong 為例）

### 步驟 1：規劃 Content ID 與名稱

| 值 | GuessSong 範例 | 說明 |
|----|----------------|------|
| `gameId` | `1001` | 後台遊戲代號 |
| `contentId` | `1002` | Content 唯一 ID（**不可與現有重複**） |
| `contentName` | `GuessSong` | 程式內識別字串 |

### 步驟 2：建立設定檔

#### `_setting/content/<contentId>_<contentName>.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<Content>
  <Type id="0" name="猜歌">
    <Level id="1" name="候室">
    </Level>
  </Type>
</Content>
```

#### `_setting/content/<contentId>_<contentName>_TimeSetting.json`

```json
{
  "RoundStart":  2000,
  "AnswerOpen":  30000,
  "AnswerClose": 1000,
  "ShowResult":  5000,
  "NextRound":   2000,
  "GameEnd":     3000
}
```

> **提醒**：設定檔修改後需同步複製到 `bin/Debug/net8.0-windows7.0/_setting/`，或在專案屬性設定「有更新時複製」。

### 步驟 3：建立 `_GameStruct.cs`

```csharp
namespace CECom.Content.GuessSong
{
    public struct GameCommand
    {
        public const string CreateRoom   = "gscr";
        public const string JoinRoom     = "gsjr";
        public const string RoomInfo     = "gsgi";
        public const string TeamStatus   = "gsts";
        public const string StartGame    = "gsst";
        public const string Question     = "gsq";
        public const string SubmitAnswer = "gsa";
        public const string RoundResult  = "gsrr";
        public const string FinalResult  = "gsfr";
    }

    public struct StageIndex
    {
        public const int Waiting     = 0;
        public const int RoundStart  = 1;
        public const int AnswerOpen  = 2;
        public const int AnswerClose = 3;
        public const int ShowResult  = 4;
        public const int GameEnd     = 9;
    }

    public struct RoomMode   { public const int Solo=1, Multi=2, Team=3; }
    public struct ScoreMode  { public const int Correct=1, Speed=2, Both=3; }
    public struct AssignMode { public const int Free=1, Auto=2; }

    public struct GuessSongError
    {
        public const int InvalidParam     = 1;
        public const int NotHost          = 2;
        public const int RoomNotFound     = 3;
        public const int RoomFull         = 4;
        public const int GameAlreadyStart = 5;
    }
}
```

### 步驟 4：建立遊戲房主體 `GuessSong.cs`

```csharp
public partial class GuessSong : MultiGame
{
    public readonly GuessSongRoomBaseInfo BaseInfo;
    public readonly GuessSongLobbyAdapter LobbyAdapter;

    private Dictionary<int, GuessSongPlayerState> m_playerState = new();
    private List<SongQuestion>   m_questionList  = new();
    private int                  m_currentRound  = 0;
    private SongQuestion         m_currentQuestion;
    private Dictionary<int, RoundAnswerRecord> m_roundAnswers = new();

    public bool IsGameRunning { get; private set; }
    public bool PendingRemove { get; private set; }

    public GuessSong(GuessSongRoomBaseInfo info, GuessSongLobbyAdapter adapter)
    {
        BaseInfo     = info;
        LobbyAdapter = adapter;
    }

    public int  PlayerEnterRoom(Player player, string nickname, int teamIndex) { ... }
    public void PlayerLeaveRoom(Player player) { ... }
    public override void GetEnterRoomInfo(Player player) { ... }
    public int  SubmitAnswer(Player player, int round, string answer) { ... }
    public void SettleRound() { ... }
    public void SettleFinal() { ... }
}
```

### 步驟 5：建立場景狀態機 `GuessSong.Stage.cs`

```csharp
partial class GuessSong
{
    private int      m_nowStage = StageIndex.Waiting;
    private DateTime m_nowTime  = DateTime.Now;

    public override void SyncSystemTime()
    {
        double elapsed = (DateTime.Now - m_nowTime).TotalMilliseconds;
        runStage(elapsed);
    }

    private void runStage(double elapsed)
    {
        switch (m_nowStage)
        {
            case StageIndex.RoundStart:
                if (elapsed >= m_stageTimes.RoundStart)
                    changeStage(StageIndex.AnswerOpen);
                break;
            case StageIndex.AnswerOpen:
                if (elapsed >= BaseInfo.RoundTimeSec * 1000)
                    changeStage(StageIndex.AnswerClose);
                break;
            case StageIndex.AnswerClose:
                if (elapsed >= m_stageTimes.AnswerClose)
                    changeStage(StageIndex.ShowResult);
                break;
            case StageIndex.ShowResult:
                if (elapsed >= m_stageTimes.ShowResult)
                {
                    bool isLastRound = (m_currentRound >= BaseInfo.RoundCount);
                    changeStage(isLastRound ? StageIndex.GameEnd : StageIndex.RoundStart);
                }
                break;
            case StageIndex.GameEnd:
                if (elapsed >= m_stageTimes.GameEnd)
                    closeAfterGame();
                break;
        }
    }

    public void changeStage(int stage)
    {
        m_nowStage = stage;
        m_nowTime  = DateTime.Now;
        switch (stage)
        {
            case StageIndex.RoundStart: stageRoundStart(); break;
            case StageIndex.ShowResult: stageShowResult(); break;
            case StageIndex.GameEnd:    stageGameEnd();    break;
        }
    }

    private void closeAfterGame()
    {
        foreach (var p in GetMultiUserList())
            ReturnLobby(p);
        LobbyAdapter.RemoveRoom(this.RoomNo, BaseInfo.RoomCode);
        PendingRemove = true;
    }
}
```

### 步驟 6：建立命令處理 `GuessSong.Command.cs`

```csharp
partial class GuessSong
{
    public override bool ReceiveFromPlayer(Player player, string cmd, string data)
    {
        switch (cmd)
        {
            case GameCommand.SubmitAnswer:    rcvSubmitAnswer(player, data); return true;
            case GameCommand.StartGame:       rcvStartGame(player);          return true;
            case ServerCommand.EnterRoomInfo: GetEnterRoomInfo(player);      return true;
            case ServerCommand.ReturnLobby:   ReturnLobby(player);           return true;
        }
        return false;
    }

    private void rcvStartGame(Player player)
    {
        if (player.MemberID != BaseInfo.HostMemberId) return;
        if (IsGameRunning) return;
        IsGameRunning = true;
        SetQuestions(LobbyAdapter.GetQuestionsForGame(BaseInfo.RoundCount));
        changeStage(StageIndex.RoundStart);
    }

    private void rcvSubmitAnswer(Player player, string data)
    {
        var rcv = JsonConvert.DeserializeObject<CmdData_SubmitAnswer_Rcv>(data);
        SubmitAnswer(player, rcv.round, rcv.answer);
        if (checkAllAnswered())
            changeStage(StageIndex.AnswerClose);
    }
}
```

### 步驟 7：建立大廳介接器 `GuessSongLobbyAdapter.cs`

```csharp
public partial class GuessSongLobbyAdapter : ContentLobbyAdapter
{
    private GuessSongStageTime      m_stageTimes  = new();
    private List<SongQuestion>      m_songPool    = new();
    private Dictionary<string, int> m_roomCodeMap = new();
    private List<int>               m_removeRooms = new();
    private int                     m_nextRoomNo  = 10001;

    public override ContentInfo InitContent()
    {
        loadTimeSetting();
        loadSongPool();
        Program.ShowToForm($"{ContentName}[{ContentID}] 初始化完成，題庫：{m_songPool.Count} 首");
        return content;
    }

    public override void SyncSystemTime()
    {
        broadcastWaitingRooms();   // 每 3 秒廣播一次等待室狀態
        // 清理待移除的房間...
    }

    public override bool DoCustomCommand(Player player, string cmd, string data)
    {
        switch (cmd)
        {
            case GameCommand.CreateRoom: rcvCreateRoom(player, data); return true;
            case GameCommand.JoinRoom:   rcvJoinRoom(player, data);   return true;
        }
        return false;
    }

    private string generateRoomCode()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 排除易混淆字元 0/O/1/I
        string code;
        do {
            code = new string(Enumerable.Range(0, 6)
                  .Select(_ => chars[Program.Random.Next(chars.Length)])
                  .ToArray());
        } while (m_roomCodeMap.ContainsKey(code));
        return code;
    }

    public void RemoveRoom(int roomNo, string roomCode)
    {
        m_removeRooms.Add(roomNo);
    }
}
```

### 步驟 8：建立報表 `GuessSongLobbyAdapter.Report.cs`

```csharp
partial class GuessSongLobbyAdapter
{
    public override bool WriteInningReport(DbPara_InningReport report)
    {
        string url = GameSetting.Config.DB_ConnString + "Report/GameRoundReportAdd";
        var sendData = new JObject(
            new JProperty("GameId",       report.GameId),
            new JProperty("ContentId",    report.ContentId),
            new JProperty("Round",        report.Round),
            new JProperty("SongAnswer",   report.SongAnswer),
            new JProperty("CorrectCount", report.CorrectCount)
        ).ToString();

        WebAccess.WebAccessResult wr = WebAccess.Post(url, sendData);
        if (!wr.IsSuccess) { Program.LogError($"[GuessSong] writeInningReport fail"); return false; }
        return true;
    }
}
```

### 步驟 9：登錄至 `GameController._Customize.cs`

```csharp
// 1. 加入 using
using CECom.Content.GuessSong;

// 2. 在 initialContents() 加入 case
switch (cname)
{
    case "Rocket":
        adapter = new RocketLobbyAdapter(gameId, cid, cname);
        break;

    case "GuessSong":        // ← 新增
        adapter = new GuessSongLobbyAdapter(gameId, cid, cname);
        break;
}
```

### 步驟 10：更新 `_Config.json`

```json
"RunContents": "1-2:Rocket,1001-1002:GuessSong"
```

重啟後 WinForms 主視窗應出現：

```
>Step: NLog 啟動!!
GuessSong[1002] 初始化完成，題庫：965 首
```

---

## 8. 場景狀態機

```
   玩家加入房間
        │
        ▼
   ┌──────────┐
   │ Waiting  │  ← 等待玩家，gsts 廣播隊伍狀態（每 3 秒）
   │   (0)    │
   └────┬─────┘
        │ 房主送出 gsst
        ▼
   ┌──────────┐
   │RoundStart│  ← stageRoundStart()：m_currentRound++，取題，廣播 gsq
   │   (1)    │
   └────┬─────┘
        │ 等待 RoundStart ms (2s)
        ▼
   ┌──────────┐
   │AnswerOpen│  ← 開放作答，全員作答完畢可提前結束
   │   (2)    │
   └────┬─────┘
        │ 等待 RoundTimeSec 秒或全員作答
        ▼
   ┌───────────┐
   │AnswerClose│ ← 緩衝期（1s）
   │   (3)     │
   └────┬──────┘
        ▼
   ┌──────────┐
   │ShowResult│  ← stageShowResult()：SettleRound()，廣播 gsrr
   │   (4)    │
   └────┬─────┘
        │
        ├── 還有下一輪 ──→ RoundStart(1)
        │
        └── 最後一輪  ──→
                          ┌──────────┐
                          │ GameEnd  │  ← 廣播 gsfr
                          │   (9)    │
                          └────┬─────┘
                               ▼
                          closeAfterGame()
                          → 所有玩家收到 pwlby
                          → LobbyAdapter.RemoveRoom()
```

---

## 9. 設定檔說明

### `_Config.json` 完整欄位

| 欄位 | 型態 | 說明 |
|------|------|------|
| `ServerName` | string | 伺服器名稱，顯示於 WinForms 標題列與 Log 前綴 |
| `ServerPort` | int | WebSocket 監聽 Port |
| `LinkType` | int | 1=WebSocket, 2=WSS |
| `RunContents` | string | ★ 啟動的遊戲清單 |
| `SystemRunMode` | int | 0=本機模擬DB, 9=正式XPG API |
| `DB_ConnString` | string | 後台 DB API 基底 URL |
| `Wallet_ConnString` | string | 錢包 API 基底 URL |
| `IsIntegerSystem` | bool | true=整數籌碼制 |
| `SystemCheck_Timeout` | int | 心跳逾時（秒） |
| `SysSD_Step1/2/3_Sec` | int | 關機三步驟各等待秒數 |

### `TimeSetting.json` 欄位（GuessSong）

| 欄位 | 預設值（ms） | 說明 |
|------|------------|------|
| `RoundStart` | 2000 | 推題後等待玩家準備的時間 |
| `AnswerOpen` | 30000 | 最長作答時間 |
| `AnswerClose` | 1000 | 截止後的緩衝期 |
| `ShowResult` | 5000 | 結果顯示時間 |
| `NextRound` | 2000 | 下輪準備時間 |
| `GameEnd` | 3000 | 遊戲結束畫面停留時間 |

---

## 10. 資料庫層說明

```csharp
// SystemRunMode = 0 → DBTester（本機模擬）
// SystemRunMode = 9 → DBXpgApi（正式 REST API）
public static IDbProvider Inst { get; }  // ManagerDB.Inst
```

### `IDbProvider` 主要方法

| 方法 | 說明 |
|------|------|
| `CheckConnection()` | 啟動時測試連線 |
| `MemberLogin(gameId, account, key)` | 玩家登入 |
| `MemberLogout(...)` | 玩家登出 |
| `WriteInningReport(...)` | 局報表 |
| `WriteMemberReport(...)` | 個人報表 |
| `GetExchangeMoney(...)` | 查詢錢包餘額 |

### 報表三層架構

```
WriteSequenceReport  ← 將（系列賽）報表（猜歌目前不使用）
WriteInningReport    ← 局報表（每輪結束後呼叫）
WriteMemberReport    ← 個人報表（每位玩家的成績）
```

---

## 11. 本機測試方法

使用 `temp/GuessSongTest.html` 進行完整流程測試：

1. 以 **Visual Studio** 啟動伺服器（Debug 模式，Port 預設 10001）
2. 確認 WinForms 視窗出現 `GuessSong[1002] 初始化完成，題庫：965 首`
3. 以瀏覽器開啟 `GuessSongTest.html`
4. 連線：輸入 `ws://localhost:10001`，點「連線」
5. 登入：輸入測試帳號，點「登入」
6. 創建房間：選擇遊戲模式，點「創建房間」→ 取得 6 碼代碼
7. 開第二個瀏覽器分頁，輸入代碼加入房間
8. 在第一個分頁（房主）點「開始遊戲」

### 常用測試命令（瀏覽器 DevTools Console）

```javascript
// 心跳
ws.send(JSON.stringify({ cmd: 'sschk', data: '' }));

// 創建房間（多人模式）
ws.send(JSON.stringify({
  cmd: 'gscr',
  data: { contentId: '1002', roomMode: 2, scoreMode: 3,
          roundCount: 5, roundTimeSec: 30, maxPlayers: 50 }
}));
```

---

## 12. 常見問題與注意事項

### Q1：Server 啟動後看不到「初始化完成」的訊息

1. `_Config.json` 的 `RunContents` 是否包含 `GuessSong`
2. `1002_GuessSong.xml` 是否存在於 `bin/_setting/content/`
3. `1002_GuessSong_TimeSetting.json` 是否存在
4. `GuessSong_Songs.json` 是否存在於 `bin/_setting/mock/`

### Q2：`gscr` / `gsjr` 命令無任何回應

`data` 中是否包含 `"contentId": "1002"`？缺少此欄位，命令會被靜默丟棄。

```json
// ✗ 錯誤
{ "cmd": "gscr", "data": { "roomMode": 2 } }

// ✓ 正確
{ "cmd": "gscr", "data": { "contentId": "1002", "roomMode": 2, ... } }
```

### Q3：新增遊戲後 `switch(cname)` 找不到對應 Case

`RunContents` 的 `contentName` 與 `GameController._Customize.cs` 的 `case` 字串必須**完全一致（含大小寫）**。

### Q4：偵錯器在 `LogInfo` 出現 `NullReferenceException`

`s_logger` 在 `RunNLog()` 執行前為 `null`。確認 `StartSystem()` 中 `RunNLog` 先於 `onInitial` 呼叫。

### Q5：設定檔每次 Build 後都要手動複製

在 Visual Studio 對 `_setting/` 下的檔案點右鍵 →「屬性」→「複製到輸出目錄」→「有更新時複製」。

### Q6：新增遊戲是否需要修改 `GameController.CmdCommon.cs`？

**不需要**。自訂命令透過 `data.contentId` 自動路由到 `LobbyAdapter.DoCustomCommand()`。只有系統級標準命令才在 `CmdCommon.cs` 中處理。

### Q7：如何增加新的場景狀態？

1. 在 `_GameStruct.cs` 的 `StageIndex` 加入新常數
2. 在 `GuessSong.Stage.cs` 的 `runStage()` 加入計時邏輯
3. 在 `changeStage()` 加入進入動作方法

---

*文件版本：v1.0 | 適用遊戲：GuessSong (contentId=1002)*
