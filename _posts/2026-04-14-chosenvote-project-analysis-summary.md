---
layout:       post
title:        "ChosenVote 專案分析彙整"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - C#
    - .NET 8
    - ASP.NET Core
    - Dapper
    - MySQL
    - 系統分析
---

## 1. 專案總覽

- 專案類型：`.NET 8` 分層式後端 API（ASP.NET Core Web API）。
- 技術棧：`C#`、`Dapper`、`MySQL`、`JWT`、`NLog`、`Swagger`、WebSocket。
- Solution：`code/slnChosenVoteApi.sln`，主要含：
  - `ChosenVoteApi`（API 入口）
  - `Repository`（資料存取層）
  - `Model`（模型與共用型別）
  - `Utilities`（加解密、工具、驗證）

## 2. 目前架構理解

- 典型資料流：
  - `Controller -> Service -> Repository -> DapperContext(MySQL)`
- 主要模組：
  - 會議：`MeetingController` / `MeetingService`
  - 即時會議：`MeetingLiveBackController` / `MeetingLiveFrontController`
  - 議案：`IssueService`
  - 選舉：`ElectionService`
  - 報到與 QRCode：`QrcodeService`
- 即時機制：
  - 透過 WebSocket 路徑 `/MeetingLive/{CheckInCode}` 進行前後台同步與流程推進。

## 3. 資料庫 Schema 重點（依 `document/ChosenVote-schema.sql`）

### 3.1 核心設計

- 主軸表：`meeting`
- 會議關聯：
  - `issue`, `subissue`, `issuevoteresult`
  - `election`, `candidate`, `electionvoteresult`
  - `attendanceqrcode`, `device`, `devicegroup`
- 人員/組織：
  - `company -> community -> residence -> property`
  - `userinfo`, `systemmanager`, `companymanager`

### 3.2 Live 雙軌模型

- 有正式表與現場表並行：
  - `meeting` / `meetinglive`
  - `issue` / `issuelive`
  - `election` / `electionlive`
  - `candidate` / `candidatelive`
  - `issuevoteresult` / `issuevoteresultlive`
  - `electionvoteresult` / `electionvoteresultlive`
- 系統看起來採「現場操作寫 live，會議結束後回寫正式表」策略。

### 3.3 結構特徵

- 多表採 `IsDeleted` 軟刪除，且索引常用 `(IsDeleted, FK)`。
- 少量明確 FK（例如 `meetingfile -> meeting`），多數一致性依賴應用層交易。
- `Threshold`、`ProcessDetail` 等 JSON 欄位用於會議規則與流程快照。
- 防重複投票：
  - `issuevoteresultlive` / `electionvoteresultlive` 有 unique key
  - 另有 `votelock` 暫存鎖表。

## 4. 文件內容理解（依 `document/004_202409_合滙_天選選務系統`）

### 4.1 文件性質

- 目前內容偏「需求草稿 + 流程草圖 + 範例資料」，不是完整規格書。

### 4.2 報到流程（drawio）

- 主要分支：`一戶`、`一戶+委託`、`多戶`、`多戶+委託`。
- 角色：`住戶`、`工作人員`、`守門員`。
- 核心動作：
  - 手寫簽名
  - 發放/掃描 QRCode
  - 委託綁定
  - 跳轉會議畫面
  - 守門員確認入場是否成功（失敗回圈協助）

### 4.3 需求草稿關鍵字（txt）

- 候選人欄位調整（現職改頭銜）
- 加權/坪數與門檻判定
- 候補名額、同票處理
- 投票結果匯出（PDF / Excel）
- 收費模式（預繳/點數/直接付費）與預估費用
- 報表彙整與歷史統計

## 5. 需求落地狀態（已實作 / 部分實作 / 未實作）

> 判斷基準：以目前 `code` 內資料模型、Service、Controller 是否有明確實作為主。

### 5.1 已實作

- 候補名額與當選狀態（`AlternateSlot`, `ElectionResult`）
- 同票可同時當選的選舉結果處理邏輯
- 多戶/委託報到與綁定流程（`AttendanceQRCode`, `DeviceGroup`, `QrcodeService`）
- 委託限制（人數/區權比）檢核
- 每人最多可投票數（`VotingMaxPerPerson`）
- 候選人顯示開關（`IsShowCandidate`）
- 匯出功能（簽到表、通知、會議紀錄、委託碼 PDF、部分 Excel）

### 5.2 部分實作

- 候選人單筆修改：可透過清單 API 單筆傳入，但非獨立單筆 API。
- 手機簡訊：有欄位與通知內容，但實際發送能力主要看到 Email，SMS 整合不完整。
- 投票結果檔案匯出：已有多種匯出能力，但是否完全符合「結果報表格式」仍待驗證。
- 使用者端電腦版投票結果：後端端點看似具備，前端呈現完整度待確認。
- 多系統管理員可見介面：資料模型存在，實際 UI/權限整合需整體驗證。

### 5.3 未實作（或尚未看到明確實作）

- 候選人「現職 -> 頭銜」欄位落地
- 投票畫面顯示批次號
- 候選人政見詳細頁（個人資料頁）
- 前台顯示「已投幾個人」
- 前台顯示「前 N 名」即時排行
- 收費/點數/預估費用機制（billing/payment）
- 統計型彙整報表與歷史趨勢報表

## 6. 目前風險與技術債

- `appsettings*.json` 含敏感資訊（DB/JWT/SMTP）風險高。
- 缺少完整自動化測試專案與覆蓋率基線。
- 缺少 CI / lint / format 基線（如 `.editorconfig`, workflow）。
- 部分套件版本有新舊混搭跡象。
- 大量應用層維護關聯，資料一致性高度依賴交易程式碼。

---

本文件為目前探索結果彙整，可作為後續規格化與開發排程基底。
