# TokenTracker

Windows Codex 桌面版的 Token 與快取用量追蹤工具。0.4 以 TT 雙字母標誌、淡紫水光浮球及更大的文字呈現累計／今日 Token、本週剩餘額度與每日任務。浮球有呼吸、水波及按壓回彈動畫，系統開啟減少動態效果時會停用動畫。

## 桌面使用

雙擊桌面的 **TokenTracker** 捷徑。更新後請完整退出目前 Codex 與舊啟動器，再重新雙擊捷徑；新版補丁會在重新啟動後載入，既有用量紀錄與位置設定保留。安裝器會替換本工具建立的舊 Codexracker 捷徑。

啟動器內含 Node 及所需模組，不需安裝 Node、pnpm 或保留專案目錄；電腦仍需安裝官方 Windows Codex App。程式位於 `%LOCALAPPDATA%/Codexracker/`，桌面捷徑指向帶建置指紋的版本化 EXE。首次準備副本約需 3 GB 空間。原 App 或副本仍執行時會提示先退出，不會強制關閉你的 App。

啟動器提供「啟動 Codex」、「檢查更新」、「回復上一版」與「開啟資料夾」。更新只重建可寫副本，不修改 WindowsApps 中的官方安裝。用量與設定固定保存在 `%LOCALAPPDATA%/Codexracker/data`，EXE 更新不會清除資料。程式快取解壓在旁邊的 `program` 目錄。

## 面板內容

- **本週總剩餘額度**：面板與浮球同步顯示官方 `account/rateLimits/read`／通知中 10,080 分鐘視窗的 `100 - usedPercent`。這是方案額度百分比，無法換算成確切剩餘 Token 數。啟動讀取、每 60 秒刷新、通知即時更新，也可按 ↻ 手動刷新。失敗保留上次數值並標示時間與狀態；過了重設時間會等待新資料。
- **累計／今日 Token**：輸入加輸出，快取輸入包含在輸入中，不重複相加。本機日期的 00:00 起算今日數字，開著面板跨日時會自動刷新；沒有紀錄顯示 0，缺少必要用量欄位則顯示未知。僅涵蓋本工具追蹤到的增量，並非帳戶全部歷史。
- **每日任務**：今日首次同步的剩餘額度除以當時剩餘使用日（不足 24 小時算一天，上限 7 天）。例如 100%／7 天＝每天約 14.29%；60%／3 天＝每天 20%。起點與目標存至本機，當天更新／重啟不會移動目標；顯示自起點已用、還需使用及完成進度。隔日或週額度重設後重算，帳戶切換時清除起點。無法回推首次同步前的當日使用量。這是使用規劃，不會自動發送任務或消耗額度。
- **即時輸出**：顯示思考、輸出、完成、中止或失敗，以及串流字數／片段數。精確 Token 隨服務端用量通知更新；串流字數不當作 Token。
- **自動模型辨識**：使用 thread 回應與已接受的回合模型覆寫；無法辨識時顯示未知。
- **Token 表格**：輸入、輸出、快取輸入的最近增量與本機累計。快取包含在輸入中，不能重複相加。首次歷史回播僅建立基準，不計入本機累計；缺失欄位顯示未知。
- **操作**：拖曳標題或使用方向鍵移動；最小化為顯示剩餘百分比的 TT 水光浮球，點擊展開。主要文字 15–16px，數字 27–40px；即時回合與 Token 明細可展開。「紀錄」查看最近 20 筆，「設定」調整不透明度。位置、最小化與不透明度會保存。

只保存正規化數值、時間、模型識別及今日額度起點，不另存提示詞、回應本文或串流文字。沒有價格或匯率的網路請求，不需要 `.env`；可選參數集中在面板設定。沿用 `%LOCALAPPDATA%/Codexracker/` 資料目錄，改名不搬移或清除原紀錄。

## 開發與封裝

```powershell
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:inspection
pnpm test:realtime-desktop
pnpm package:windows
$release = Get-Content release/latest.json -Raw | ConvertFrom-Json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File launcher/install-shortcut.ps1 -Executable $release.executable
```

`test:realtime-desktop` 在隔離的實際 Codex Renderer 中注入合成串流與額度，測試模型、累計／今日 Token、固定每日目標、週額度刷新、顯示設定、拖曳、紀錄、浮球動畫、減少動態效果與重啟保存，不發送模型請求。完成後還原實驗副本並逐檔核對官方來源。結果見 [面板驗收](tokentracker-desktop-evidence.json)、[實際截圖](tokentracker-hud.png)、[浮球](tokentracker-bubble.png) 與 [還原核對](tokentracker-restoration.json)。

建置以 Windows 內建 .NET Framework C# 編譯器生成 WinForms EXE，內嵌精選 runtime 模組、桌面產物、Node 與授權文件，輸出至 `release/<時間>/TokenTracker.exe`，附帶 TT 圖示；最新位置及 SHA256 見 `release/latest.json`。自解壓核對封裝及逐檔 SHA256。未包含官方商店 runtime 的再散布。Node 版本變更時需更新 `launcher/licenses/` 的授權文件。

## 開發副本更新與回復

完整關閉原 App 及所有追蹤副本後：

```powershell
pnpm build
pnpm desktop:sync
pnpm desktop:start
# 前景監看，每 60 秒檢查更新
pnpm desktop:watch
# 已有前一個通過驗證的版本時
pnpm desktop:rollback
pnpm desktop:start
```

開發用副本保存在 `.local-runtime/desktop`，與桌面正式安裝的資料目錄分開。所有版本共用 profile，更新與回復保留紀錄。管理器檢查註冊套件身分、版本及關鍵檔案指紋，在來源穩定且 App 關閉後建立完整副本、逐檔驗證、注入、啟動 Renderer 驗證，最後原子切換 `active.json`。失敗保留既有可用版本。

`defer-running-app` 表示 App 尚未退出；`defer-unstable-source` 表示來源變動；`defer-failed-build` 避免對相同失敗來源反覆重建；`defer-rolled-back-build` 避免立即重啟已回復的版本。`manager.lock` 阻擋並行操作，若意外中止留下鎖，先確認檔內 PID 已不存在再移除。工具不自動刪除舊版本。尚未發生實際 Store 版本升級，模擬更新測試不代表真實商店升級驗收。

## 參考與歷史證據

沿用 [Svelte](https://github.com/sveltejs/svelte)、[lowdb](https://github.com/typicode/lowdb)、[WinForms](https://github.com/dotnet/winforms)、[Node.js](https://github.com/nodejs/node)、[Playwright](https://github.com/microsoft/playwright) 及 Electron ASAR／Fuses 模組。設計前已搜尋 GitHub 的 [CSS 進度元件](https://github.com/codepo8/css-progress-bar)，沿用既有 Svelte、CSS keyframes 與 SVG 實作，無新增依賴。

[開發計畫](PLAN.md)、[先前真實用量驗證](phase-four-live-evidence.json)、[先前真實串流與額度驗證](realtime-live-evidence.json) 保留為歷史證據；舊報告中的價格功能已在 0.3 移除。

以下測試會發送真實模型請求，通常不需要為版面修改執行：

```powershell
pnpm test:realtime-live C:/Users/Yumai/.codex
pnpm test:live-desktop C:/Users/Yumai/.codex
```
