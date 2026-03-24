---
layout:       post
title:        "XPG GameServer — Linux 移植建置指南"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - C#
    - Linux
    - Game Server
    - Google Cloud
    - 架構設計
---

> 目標：在**不改動任何遊戲邏輯**的前提下，讓同一份程式碼能夠同時在  
> Windows（WinForms 開發模式）與 Linux（Console 生產模式）上執行。

## 背景說明

### 為何移植到 Linux？

| 項目 | Windows VM | Linux VM | 差異 |
|------|-----------|---------|------|
| GCE `c2-standard-4` | ~$245/月（含授權） | ~$175/月 | 省 ~29% |
| GCE `c2-standard-8` | ~$490/月 | ~$350/月 | 省 ~29% |

WinForms 視窗僅提供開發時的監控介面（Log 列表、玩家人數顯示），  
所有**核心功能均在 `GameController` 及其相關類別**中，與 WinForms 無關。

### 現有阻礙

| 阻礙 | 所在位置 | 處理方式 |
|------|---------|---------|
| `net8.0-windows7.0` TFM | `XpgServer.csproj` | 新增一個 Linux 專案，TFM 改為 `net8.0` |
| `UseWindowsForms` | `XpgServer.csproj` | 新 Linux 專案不使用此設定 |
| `Application.StartupPath` | `FormMain.cs` 第 102 行（**僅 1 處**） | 改為 `AppDomain.CurrentDomain.BaseDirectory` |
| `Program.ShowToForm()` 散佈 14 個檔案 | 全專案 | 抽介面，呼叫端**完全不用改** |
| `FormMain`（WinForms Form） | `FormMain.cs` / `.Designer.cs` | Linux 版以 `ConsoleView` 取代 |

---

## 方案架構

```
XpgServer.sln
  │
  ├── GameServer/                     ← 現有專案（維持不動）
  │     ├── XpgServer.csproj          net8.0-windows7.0 + WinForms
  │     ├── Program.cs                WinForms 進入點
  │     ├── FormMain.cs               監控視窗
  │     └── [所有遊戲邏輯檔案]
  │
  └── GameServerLinux/                ← 新增專案
        ├── XpgServerLinux.csproj     net8.0（跨平台）
        ├── Program.Linux.cs          Console 進入點（新增）
        ├── IServerView.cs            視圖介面（新增，兩專案共用）
        ├── ConsoleView.cs            Console 實作（新增）
        └── [連結 GameServer/ 的所有共用 .cs]
```

**關鍵原則**：`GameServerLinux/` 不複製任何遊戲邏輯檔，  
使用 MSBuild 的 `<Compile Include>` 連結（Link）原始專案的 `.cs` 檔，  
確保兩個專案永遠共用同一份程式碼，沒有維護分叉。

---

## 需要改動的現有程式碼

### 改動 1：`FormMain.cs` 第 102 行（1 行）

```csharp
// 改前
if (!GameSetting.Initialize(Application.StartupPath)) return;

// 改後（兩個平台都適用）
if (!GameSetting.Initialize(AppDomain.CurrentDomain.BaseDirectory)) return;
```

### 改動 2：`Program.cs` — `ShowToForm()` 改為透過介面（~8 行）

```csharp
// 新增靜態屬性
public static IServerView View { get; set; }

// ShowToForm 改為
public static void ShowToForm(string msg, Boolean powerShow)
{
    View?.AddLog(DateTime.Now.ToString("MM/dd hh:mm:ss") + " " + msg);
}
```

> **重要**：`ShowToForm` 的簽名不變，14 個呼叫端檔案**一個字都不需要改**。

---

## 需要新增的檔案

### 1. `IServerView.cs`（共用，約 15 行）

抽象出 WinForms 視窗的所有公開方法：

```csharp
namespace CECom
{
    public interface IServerView
    {
        void AddLog(string msg);
        void ShowClientConnections(int count);
        void ShowTotalPlayerCount(int total, int npcs);
        void ShowNpcWaitCount(int total, int nowCount);
        void ShowRoomsPlayerCount(int total, int npcs);
        void ShowRoomNumber(int number);
        void ShowPrizePool(decimal money);
    }
}
```

`FormMain` 同步實作此介面（修改宣告：`public partial class FormMain : Form, IServerView`）。

### 2. `ConsoleView.cs`（Linux 用，約 50 行）

```csharp
namespace CECom
{
    public class ConsoleView : IServerView
    {
        public void AddLog(string msg)                    => Console.WriteLine(msg);
        public void ShowClientConnections(int c)          { }
        public void ShowTotalPlayerCount(int t, int n)    { }
        public void ShowNpcWaitCount(int t, int n)        { }
        public void ShowRoomsPlayerCount(int t, int n)    { }
        public void ShowRoomNumber(int n)                 { }
        public void ShowPrizePool(decimal m)              { }
    }
}
```

### 3. `Program.Linux.cs`（Linux 進入點，約 40 行）

```csharp
namespace CECom
{
    static class Program
    {
        public static IServerView    View       { get; set; }
        public static GameController Controller => s_controller;
        private static GameController s_controller;

        static void Main(string[] args)
        {
            View = new ConsoleView();

            if (!GameSetting.Initialize(AppDomain.CurrentDomain.BaseDirectory))
            {
                Console.WriteLine("## GameSetting 初始化失敗，程式終止。");
                return;
            }

            s_controller = new GameController();
            s_controller.StartSystem();

            Console.WriteLine("伺服器已啟動，按 Ctrl+C 結束。");
            var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
            cts.Token.WaitHandle.WaitOne();

            s_controller.StartShutdown();
        }

        public static void ShowToForm(string msg)               => View?.AddLog(msg);
        public static void ShowToForm(string msg, bool show)    => View?.AddLog(msg);
        public static void LogTrace(string msg, bool s = false) { /* NLog */ }
        public static void LogInfo(string msg, bool s = false)  { /* NLog */ }
        public static void LogWarn(string msg, bool s = false)  { /* NLog */ }
        public static void LogError(string msg, bool s = false) { /* NLog */ }
        public static void Exit() => Environment.Exit(0);
        public static bool IsGameTrack  = false;
        public static bool UserAutoPlay = false;
        public static Random Random     = new Random();
        public static bool RunNLog()    { /* 與 Windows 版相同 */ return true; }
    }
}
```

### 4. `XpgServerLinux.csproj`（新專案設定）

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <RootNamespace>CECom</RootNamespace>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Google.Cloud.Logging.NLog"     Version="5.2.0" />
    <PackageReference Include="Microsoft.Extensions.Http"     Version="9.0.7" />
    <PackageReference Include="Newtonsoft.Json"               Version="13.0.3" />
    <PackageReference Include="NLog"                          Version="6.0.2" />
    <PackageReference Include="NLog.Extensions.Logging"       Version="6.0.2" />
    <PackageReference Include="NLog.Web.AspNetCore"           Version="6.0.2" />
    <PackageReference Include="System.Text.Encoding.CodePages" Version="9.0.7" />
  </ItemGroup>

  <!-- 連結 GameServer 共用邏輯（不複製） -->
  <ItemGroup>
    <Compile Include="../GameServer/**/*.cs"
             Exclude="../GameServer/FormMain.cs;
                      ../GameServer/FormMain.Designer.cs;
                      ../GameServer/Program.cs;
                      ../GameServer/obj/**" />
  </ItemGroup>
</Project>
```

---

## 工作量彙整

| 工作項目 | 類型 | 預估行數 | 影響現有程式碼 |
|---------|------|---------|-------------|
| `FormMain.cs` 第 102 行替換 | 修改 | 1 行 | 極低 |
| `Program.cs` 加 `View` 介面 | 修改 | ~8 行 | 低（僅 `Program.cs`） |
| `FormMain.cs` 實作 `IServerView` | 修改宣告 | 1 行 | 無 |
| `IServerView.cs` | 新增 | ~15 行 | 無 |
| `ConsoleView.cs` | 新增 | ~50 行 | 無 |
| `Program.Linux.cs` | 新增 | ~40 行 | 無 |
| `XpgServerLinux.csproj` | 新增 | ~30 行 | 無 |
| **合計修改現有程式碼** | | **~10 行** | |
| **合計新增程式碼** | | **~135 行** | |

---

## 部署方式

### Local 佈建（Windows 開發者常用）

> 適用情境：開發人員在 Windows 本機 build，再部署到內網 Linux 主機測試（例如 `192.168.1.137`）。

#### 1) 在 Windows（PowerShell）建置 Linux 發佈檔

```powershell
# 建議在 repo 根目錄執行
dotnet publish "GameServerLinux/XpgServerLinux.csproj" -c Release -r linux-x64 --self-contained true -o "./publish/linux"
```

> PowerShell 不能使用 bash 的 `\` 換行，若要換行請用反引號 `` ` ``，或直接用單行指令。

#### 2) 確認發佈產物

```powershell
Get-ChildItem ".\publish\linux"
```

至少要看到：

- `XpgServerLinux`（可執行檔）
- `NLog.json`（若缺少，程式啟動時會自動建立預設檔）
- 其餘 .NET runtime 相關檔案

#### 3) 上傳到 Linux 主機（scp）

```powershell
scp -r ".\publish\linux\*" user@192.168.1.137:/opt/xpgserver/
```

> 將 `user` 改成 Linux 帳號。  
> 若你使用 WinSCP / SMB 也可手動複製到 `/opt/xpgserver`。

#### 4) 補上 `_setting/`（可手動）

你已確認 `_setting` 會手動加入，請確認路徑如下：

```text
/opt/xpgserver/
  ├── XpgServerLinux
  ├── NLog.json
  └── _setting/
      ├── _Config.json
      ├── _System.json
      ├── content/
      └── ...
```

#### 5) 在 Linux 啟動與檢查

```bash
ssh user@192.168.1.137
cd /opt/xpgserver
chmod +x ./XpgServerLinux
./XpgServerLinux
```

若要看程序：

```bash
ps -ef | grep XpgServerLinux
```

若要暫停：

- 前景執行：`Ctrl+C`
- 背景服務：搭配 `systemd`

### Linux 生產環境建置

```bash
# 在 Windows 交叉編譯（Publish 為 Linux x64 單一執行檔）
dotnet publish GameServerLinux/XpgServerLinux.csproj \
  -c Release \
  -r linux-x64 \
  --self-contained true \
  -o ./publish/linux

# 上傳到 GCE VM
gcloud compute scp ./publish/linux/* your-vm:/opt/xpgserver/ --zone=asia-east1-b

# 啟動
ssh your-vm "cd /opt/xpgserver && ./XpgServerLinux"
```

### Dockerfile（可選，用於 GKE 部署）

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish GameServerLinux/XpgServerLinux.csproj \
    -c Release -r linux-x64 --self-contained true -o /app

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /app .
COPY _setting/ ./_setting/
ENTRYPOINT ["./XpgServerLinux"]
```

### systemd 服務（開機自動啟動）

```ini
# /etc/systemd/system/xpgserver.service
[Unit]
Description=XPG Game Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/xpgserver
ExecStart=/opt/xpgserver/XpgServerLinux
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable xpgserver
systemctl start xpgserver
systemctl status xpgserver
```

---

## 注意事項

### Linux 檔案路徑大小寫敏感

Windows 不分大小寫，Linux 嚴格分大小寫。  
確認 `_setting/` 目錄下的所有檔名與程式碼中引用的路徑**大小寫完全一致**。

### NLog 設定

`NLog.json` 中的 `fileName` 路徑若使用反斜線 `\` 需改為正斜線 `/`，  
或使用 `Path.Combine()` 確保跨平台相容。

### 測試建議

移植完成後，建議先在 Windows 上執行 `GameServerLinux` 專案驗證功能正確，  
再部署至 Linux 環境，可排除大多數跨平台問題。

---

## 實作順序

- Step 1：在 `FormMain.cs` 修改 `Application.StartupPath`（1 行）
- Step 2：新增 `IServerView.cs`
- Step 3：`FormMain` 宣告實作 `IServerView`
- Step 4：`Program.cs` 加入 `View` 靜態屬性，`ShowToForm` 改透過介面
- Step 5：新增 `ConsoleView.cs`
- Step 6：新增 `GameServerLinux/` 資料夾與 `XpgServerLinux.csproj`
- Step 7：新增 `Program.Linux.cs`
- Step 8：加入 `.sln` 方案，確認兩個專案都能 Build 成功
- Step 9：在 Windows 執行 Linux 版本，驗證功能正常
- Step 10：部署至 Linux GCE VM 測試

---

*文件版本：v1.0 (2026-03-17) | 適用專案：XPG GameServer*
