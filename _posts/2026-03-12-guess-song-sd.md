---
layout:       post
title:        "猜歌遊戲（GuessSong）系統設計文件（SD）"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - C#
    - Game Server
    - Game Design
    - 系統設計
---

> 版本：v1.0　　日期：2026-03-06　　狀態：開發參考用

## 一、架構概覽

猜歌遊戲完全遵循 XPG Server 既有的 **Content 擴充架構**，新增一個 `Content/GuessSong/` 模組，掛載至 `GameController._Customize` 後即可運行，不影響現有遊戲。

```
GameServer/
├── GameController._Customize.cs   ← 新增 registerContent("GuessSong", ...)
└── Content/
    ├── Rocket/      （現有）
    ├── XocDia/      （現有）
    └── GuessSong/   （新增）
        ├── _GameStruct.cs
        ├── GuessSong.cs
        ├── GuessSong.Stage.cs
        ├── GuessSong.Command.cs
        ├── GuessSongLobbyAdapter.cs
        ├── GuessSongLobbyAdapter.BgLine.cs
        └── GuessSongLobbyAdapter.Report.cs
```

---

## 二、檔案設計說明

### 2.1 `_GameStruct.cs` — 資料結構與命令定義

#### 命令常數

```csharp
namespace CECom.Content.GuessSong
{
    public class GameCommand
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
}
```

#### 場景索引

```csharp
public struct StageIndex
{
    public const int Waiting      = 0;   // 等待玩家加入
    public const int RoundStart   = 1;   // 本輪開始（推送題目）
    public const int AnswerOpen   = 2;   // 開放作答（倒數計時）
    public const int AnswerClose  = 3;   // 截止作答（收集結果）
    public const int ShowResult   = 4;   // 公布結果（推送本輪結算）
    public const int GameEnd      = 9;   // 遊戲結束（推送最終結算）
}
```

#### 場景時間（`_TimeSetting.json`）

```json
{
  "RoundStart":   2000,
  "AnswerOpen":  30000,
  "AnswerClose":  1000,
  "ShowResult":   5000,
  "NextRound":    2000
}
```

#### 房間模式常數

```csharp
public struct RoomMode
{
    public const int Solo  = 1;
    public const int Multi = 2;
    public const int Team  = 3;
}

public struct ScoreMode
{
    public const int Correct  = 1;   // 答對加分（固定 100）
    public const int Speed    = 2;   // 速度加分（時間遞減）
    public const int Both     = 3;   // 兩者疊加（最高 200）
}

public struct AssignMode
{
    public const int Free  = 1;   // 自由選隊
    public const int Auto  = 2;   // 系統平均分配
}
```

#### 核心資料結構

```csharp
public class TeamInfo
{
    public int    TeamIndex;
    public string TeamName;
    public int    MemberCount;
    public int    TotalScore;
}

public class GuessSongPlayer
{
    public string Nickname;
    public int    TeamIndex;    // -1 = 無隊伍（個人/多人模式）
    public int    TotalScore;
    public int    CorrectCount;
    public bool   HasAnswered;  // 本輪是否已作答
}

public class GuessSongRoomBaseInfo : RoomBaseInfo
{
    public readonly string   RoomCode;
    public readonly int      RoomMode;
    public readonly int      ScoreMode;
    public readonly int      RoundCount;
    public readonly int      RoundTimeSec;
    public readonly int      MaxPlayers;
    public readonly int      TeamCount;
    public readonly int      AssignMode;
    public readonly string[] TeamNames;
    public readonly int      HostMemberId;
}

public class SongQuestion
{
    public int    SongId;
    public string TrackName;
    public string ArtistName;
    public int    ReleaseYear;
    public string PreviewUrl;
    public string ArtworkUrl;
}

public class RoundAnswerRecord
{
    public int    MemberId;
    public string Answer;
    public double AnswerTimeSec;
    public bool   IsCorrect;
    public int    RoundScore;
}
```

#### 命令 DTO

```csharp
// gscr 創建房間 - 收
public class CmdData_CreateRoom_Rcv : CmdDataObject
{
    public int      roomMode     = 0;
    public int      scoreMode    = 0;
    public int      roundCount   = 10;
    public int      roundTimeSec = 30;
    public int      maxPlayers   = 100;
    public int      teamCount    = 0;
    public string[] teamNames    = null;
    public int      assignMode   = 1;
}

// gscr 創建房間 - 送
public class CmdData_CreateRoom_Send : CmdDataObject
{
    public int        code     = 0;
    public string     roomCode = "";
    public int        roomMode = 0;
    public TeamInfo[] teams    = null;

    public CmdData_CreateRoom_Send(int code) { this.code = code; }
    public CmdData_CreateRoom_Send(int code, string roomCode, int roomMode, TeamInfo[] teams)
    { this.code = code; this.roomCode = roomCode; this.roomMode = roomMode; this.teams = teams; }
}

// gsjr 加入房間 - 收
public class CmdData_JoinRoom_Rcv : CmdDataObject
{
    public string roomCode  = "";
    public string nickname  = "";
    public int    teamIndex = -1;
}

// gsjr 加入房間 - 送
public class CmdData_JoinRoom_Send : CmdDataObject
{
    public int    code         = 0;
    public int    assignedTeam = -1;
    public string teamName     = "";

    public CmdData_JoinRoom_Send(int code) { this.code = code; }
    public CmdData_JoinRoom_Send(int code, int assignedTeam, string teamName)
    { this.code = code; this.assignedTeam = assignedTeam; this.teamName = teamName; }
}

// gsq 推送題目 - 送
public class CmdData_Question_Send : CmdDataObject
{
    public int      round        = 0;
    public int      totalRounds  = 0;
    public string   previewUrl   = "";
    public string   artworkUrl   = "";
    public string   artistName   = "";
    public int      releaseYear  = 0;
    public string[] chars        = null;
    public int      answerLength = 0;
    public int      timeSec      = 30;
}

// gsa 提交答案 - 收 / 送
public class CmdData_SubmitAnswer_Rcv : CmdDataObject
{
    public int    round  = 0;
    public string answer = "";
}

public class CmdData_SubmitAnswer_Send : CmdDataObject
{
    public int code  = 0;
    public int round = 0;
    public CmdData_SubmitAnswer_Send(int code, int round) { this.code = code; this.round = round; }
}

// gsrr 本輪結果 - 送
public class CmdData_RoundResult_Send : CmdDataObject
{
    public class MyResult
    {
        public bool   isCorrect  = false;
        public double answerTime = 0;
        public int    roundScore = 0;
        public int    totalScore = 0;
    }
    public class TeamRankItem
    {
        public int    index      = 0;
        public string name       = "";
        public int    totalScore = 0;
    }

    public int            round      = 0;
    public string         answer     = "";
    public string         artistName = "";
    public MyResult       myResult   = null;
    public TeamRankItem[] teamRank   = null;
}

// gsfr 最終結算 - 送
public class CmdData_FinalResult_Send : CmdDataObject
{
    public class PlayerRankItem
    {
        public string nickname = "";
        public string teamName = "";
        public int    score    = 0;
    }
    public class TeamRankItem
    {
        public int    index      = 0;
        public string name       = "";
        public int    totalScore = 0;
        public int    rank       = 0;
    }

    public int              myRank     = 0;
    public int              myScore    = 0;
    public TeamRankItem[]   teamRank   = null;
    public PlayerRankItem[] topPlayers = null;
}
```

---

### 2.2 `GuessSong.cs` — 遊戲房主體（繼承 `MultiGame`）

主要職責：
- 管理房內玩家清單（`Dictionary<int, GuessSongPlayer>`）
- 記錄當前輪次狀態、作答紀錄
- 提供計分計算函式
- 管理隊伍分數聚合

```csharp
public class GuessSong : MultiGame
{
    private GuessSongRoomBaseInfo m_baseInfo;
    private Dictionary<int, GuessSongPlayer> m_players;
    private List<SongQuestion> m_questionList;
    private int m_currentRound = 0;
    private SongQuestion m_currentQuestion = null;
    private List<RoundAnswerRecord> m_roundAnswers;
    private Dictionary<int, int> m_teamScores;   // [teamIndex, score]

    public int CalcRoundScore(bool isCorrect, double answerTimeSec) { ... }
    public int AssignTeamAuto() { ... }
    public void SettleRound() { ... }
}
```

---

### 2.3 `GuessSong.Stage.cs` — 場景狀態機

```
Waiting(0)
  ↓ [房主下達 gsst]
RoundStart(1)  ← 推送題目 gsq
  ↓ [RoundStart 時間到]
AnswerOpen(2)  ← 倒數計時開始
  ↓ [全員作答完畢 OR 時間到]
AnswerClose(3) ← 關閉接收
  ↓ [AnswerClose 時間到]
ShowResult(4)  ← 推送 gsrr
  ↓ [ShowResult 時間到]
  ├─ 還有下一輪 → RoundStart(1)
  └─ 最後一輪   → GameEnd(9)
GameEnd(9)     ← 推送 gsfr → 返回大廳
```

---

### 2.4 `GuessSong.Command.cs` — 遊戲內命令處理

| 命令 | 處理邏輯 |
|------|---------|
| `gsa` 提交答案 | 確認場景為 AnswerOpen、確認玩家未重複提交、紀錄作答時間、存入 `m_roundAnswers`、若全員作答完畢則提前進入 AnswerClose |
| `gsst` 開始遊戲 | 確認命令者為房主、場景為 Waiting、進入 RoundStart |

---

### 2.5 `GuessSongLobbyAdapter.cs` — 大廳介接器

主要職責：
- 讀取設定檔，初始化房間結構
- 處理大廳命令（`gscr` 創房、`gsjr` 加入）
- 房間代碼產生與管理（`Dictionary<string, int>` RoomCode → RoomNo）
- 等待室人數廣播排程（每 5 秒）

#### 房間代碼產生邏輯

```csharp
private string GenerateRoomCode()
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
```

---

### 2.6 `GuessSongLobbyAdapter.BgLine.cs` — 背景非同步作業

| 作業 | 說明 |
|------|------|
| 等待室廣播 | 每 5 秒推送 `gsts` 給等待中的玩家 |
| 題庫預載 | 遊戲開始前從 API 取得本場所有題目 |
| 房間逾時清理 | 等待室超過設定時間無人則自動銷毀 |

---

### 2.7 `GuessSongLobbyAdapter.Report.cs` — 報表三層

| 層級 | 函式 | 寫入時機 | 內容 |
|------|------|---------|------|
| 將報表 | `WriteSequenceReport` | 遊戲結束 | 場次 ID、房間資訊、參與人數、隊伍最終分數 |
| 局報表 | `WriteInningReport` | 每輪結束 | 輪次、答案、答對人數、各隊得分 |
| 個人報表 | `WriteMemberReport` | 每輪結束 | 玩家 ID、作答時間、是否正確、得分 |

---

## 三、DB 層設計

### 3.1 `IDbProvider` 新增介面方法

```csharp
Task<List<SongQuestion>> GetSongQuestionsAsync(int count, string tag = null);
```

### 3.2 `GuessSongMockDb`（開發期）

從本地 JSON 檔讀取固定題庫：

```
_setting/mock/GuessSong_Songs.json   ← 至少 30 首純中文歌名
```

### 3.3 `GuessSongApiDb`（正式環境）

```
GET {Song_ConnString}/Song/Random?count=10&tag=華語
```

---

## 四、設定檔設計

### 4.1 `_Config.json` 新增欄位

```json
{
  "RunContents": "1001-1001:Rocket,1001-1002:GuessSong",
  "Song_ConnString": "https://song-api.example.com"
}
```

### 4.2 `_setting/content/1002_GuessSong.xml`

```xml
<Content id="1002" name="GuessSong">
  <Type id="0" name="猜歌">
    <Level id="1" name="公廳" maxRoom="1" maxPlayer="100" />
    <Level id="2" name="自創房" maxRoom="50" maxPlayer="100" />
  </Type>
</Content>
```

### 4.3 `_setting/content/1002_GuessSong_TimeSetting.json`

```json
{
  "RoundStart":   2000,
  "AnswerOpen":  30000,
  "AnswerClose":  1000,
  "ShowResult":   5000,
  "NextRound":    2000
}
```

---

## 五、`GameController._Customize.cs` 登錄

```csharp
private void initialContents()
{
    registerContent("Rocket",    () => new RocketLobbyAdapter());
    registerContent("XocDia",    () => new XocDiaLobbyAdapter());
    registerContent("GuessSong", () => new GuessSongLobbyAdapter());  // ← 新增
}
```

> ⚠️ 此步驟不可遺漏，否則 `_Config.json` 的 `RunContents` 設定無法生效。

---

## 六、字元列表產生邏輯

Server 產生字元列表後傳給 Client，**Client 自行隨機排列顯示**。

### 產生規則

```csharp
public string[] GenerateCharList(string answer)
{
    var chars = new List<string>(answer.Select(c => c.ToString()));
    int targetCount = Math.Clamp(answer.Length * 3, 12, 24);
    int noiseCount  = targetCount - answer.Length;

    var noisePool  = LoadNoiseChars();
    var noiseChars = noisePool
        .Where(c => !chars.Contains(c))
        .OrderBy(_ => Program.Random.Next())
        .Take(noiseCount);

    chars.AddRange(noiseChars);
    return chars.ToArray();
}
```

### 干擾字庫來源

優先從**其他題庫歌名字元**中取，確保干擾字有意義。
備用使用固定常用中文字清單（`_setting/content/1002_GuessSong_NoiseChars.txt`）。

---

## 七、隊伍平均分配演算法

```csharp
private int AssignTeamAuto(int teamCount, int[] teamSizes)
{
    int minSize = teamSizes.Min();
    var candidates = Enumerable.Range(0, teamCount)
                               .Where(i => teamSizes[i] == minSize)
                               .ToList();
    return candidates[Program.Random.Next(candidates.Count)];
}
```

---

## 八、計分公式

### 答對加分（ScoreMode = 1）

```
roundScore = isCorrect ? 100 : 0
```

### 速度加分（ScoreMode = 2）

```
speedScore = isCorrect ? Max(0, 100 - Floor(answerTimeSec) * 3) : 0
```

> 每秒扣 3 分，最低 0 分，10 秒內答對至少得 70 分。

### 兩者疊加（ScoreMode = 3）

```
roundScore = (isCorrect ? 100 : 0) + (isCorrect ? Max(0, 100 - Floor(answerTimeSec) * 3) : 0)
```

---

## 九、大人數效能設計

| 問題 | 設計方案 |
|------|---------|
| 100 人同時作答，廣播量大 | 等待室 `gsts` 每 5 秒廣播，非即時；`gsrr` 時間到後一次廣播 |
| 本輪結算延遲 | Server 以記憶體 `Dictionary` 暫存作答，不做即時計算，時間到批次結算 |
| 排行榜資料量 | `gsfr` 只回傳各隊總分 + 前 10 名個人，不回傳全部 100 人 |
| 等待室個人列表 | `gsts` 只推送各隊人數數字，不推送個人清單 |

---

## 十、開發建議順序

| 步驟 | 工作項目 | 對應檔案 |
|------|---------|---------|
| 1 | 定義所有資料結構與命令 DTO | `_GameStruct.cs` |
| 2 | 實作 mockJSON 題庫 | `GuessSong_Songs.json` + `GuessSongMockDb.cs` |
| 3 | 個人模式房間 + 場景狀態機 | `GuessSong.cs` + `GuessSong.Stage.cs` |
| 4 | 作答命令 + 計分邏輯 | `GuessSong.Command.cs` |
| 5 | 多人模式（代碼加入）| `GuessSongLobbyAdapter.cs` |
| 6 | 隊伍模式（分配邏輯）| `GuessSong.cs` + `GuessSongLobbyAdapter.cs` |
| 7 | 報表三層 | `GuessSongLobbyAdapter.Report.cs` |
| 8 | 接入正式 Song API | `GuessSongApiDb.cs` |
| 9 | 100 人壓力測試 | — |

---

*文件版本：v1.0　　最後更新：2026-03-06*
