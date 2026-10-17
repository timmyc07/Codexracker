# TokenTracker

Windows Codex 的 Token、快取與額度追蹤工具。0.5 直接啟動已安裝的官方 Codex，以本機管線在視窗內載入 TokenTracker；不修改或複製官方 EXE、DLL、ASAR，也不開 TCP 除錯伺服器。官方簽章與商店更新流程保留。

## 桌面使用

雙擊桌面的 **TokenTracker**。TT 水光浮球會顯示本週剩餘百分比，點擊展開淡紫面板。位置、最小化、不透明度、用量與每日任務沿用原資料位置。

可攜包內含官方簽章完整的 Node 與所需程式，不需要另行安裝 Node、pnpm 或保留專案。電腦需安裝官方 Windows Codex。桌面捷徑直接執行該 Node 的文字啟動選單，會自動開啟 Codex；沒有自行編譯的未簽署 EXE。TT 圖示與 Codex 內的浮球、面板不變。

新版不再建立約 3 GB 的應用程式副本；程式與舊版本留在 `%LOCALAPPDATA%/Codexracker/program/`，資料留在 `%LOCALAPPDATA%/Codexracker/data/`。舊副本不會再啟動，也不自動刪除。

啟動器提供「啟動 Codex」、「檢查更新」、「回復上一版」與「開啟資料夾」。檢查更新會核對已安裝的官方 Codex 版本，下次啟動直接使用該版本。回復只切換已核對雜湊的 TokenTracker 管線程式，保留用量與設定；首次使用新架構尚無可回復版本。回復後會保留該選擇，直到安裝更新的 TokenTracker。

更新或回復前，請完整結束 TokenTracker 啟動的 Codex，再重新使用啟動器；程式不會自動關閉你的工作視窗。關閉啟動器不會關閉正在使用的 Codex。官方 Codex 結束後，伴隨程序與管線會一併退出。官方原本的 Codex 視窗可繼續使用。

## 保留的功能

- **TT 水光浮球與大字面板**：浮球有呼吸、水波與按壓回彈動畫，餘額直接可見；減少動態效果時停用動畫。主要文字 15–16px、數字 27–40px。
- **浮球與面板移動**：滑鼠或觸控可拖曳浮球，方向鍵也可移動。點擊才展開，拖曳放開不會誤開面板。收合保留浮球錨點，靠近邊緣時只調整面板顯示範圍；用量刷新、內容高度與設定回應不會拉動位置。拖曳時以 transform 跟手，放開才儲存，並使用 Svelte 內建 Spring 與內層水光動畫呈現回彈；滑鼠感應區保持固定。
- **累計／今日 Token**：輸入加輸出，快取已包含在輸入中，不重複相加。今日依本機 00:00 起算，開著面板跨日會更新。空紀錄顯示 0，缺必要欄位顯示未知。這是本機追蹤到的增量，不是帳戶完整歷史。
- **本週與短期剩餘額度**：觀察 Codex 的額度回應／通知，週視窗為 10,080 分鐘，顯示 `100 - usedPercent`。每 60 秒刷新，可手動更新；刷新失敗會標示並保留上次資料，過了重設時間則等待同步。額度百分比不能換算成確切剩餘 Token。
- **每日任務**：今日首次同步剩餘額度 ÷ 當時剩餘使用日（不足 24 小時算一天，上限 7 天）。100%／7 天約每天 14.29%。起點與固定目標保存至當日結束，顯示已用、還需使用與完成進度；隔日／週重設後重算。只能計算首次同步後的當日消耗，不會自動發送模型任務。
- **即時狀態與模型**：顯示思考、輸出、完成、中止或失敗，觀察模型回應與已接受的回合覆寫。串流字數／片段即時更新；精確 Token 等服務端回報，不以字數估算。
- **操作與紀錄**：拖曳標題或浮球、原位收合、最近 20 筆紀錄、不透明度設定、可展開的 Token 明細與即時回合資訊。

## 資料與 Windows 防護

沿用 `%LOCALAPPDATA%/Codexracker/data/profile/codexracker/metrics.json`，不搬移、不清空歷史。只有正規化數值、時間、模型識別、顯示設定與當日額度起點會寫入。提示詞、回應本文、串流文字與原始通知不另存。首次歷史回播只建立基準，重啟不重複計數。多視窗通知會去重。

程式透過 Chromium 的 `--remote-debugging-pipe` 與繼承的 OS 管線通訊。綁定的讀寫只接受官方 `app:` 頁面的主畫面執行環境，不接受其他網站或子框架。頁面只會傳出 TokenTracker 需要的數值；設定寫入仍由單一 Node 程序驗證與序列化處理。

沒有 TCP 除錯埠、LAN 伺服器、EXE 補丁、ASAR 重封裝、下載後執行腳本或防火牆放行規則。程式不修改 Defender、防火牆、App Control、SmartScreen、PowerShell 執行原則或信任憑證。官方 Codex 自己的網路功能仍由 Windows 管理；公司原則仍可能限制 Node 或程式碼的執行。

本機事件 3033／3077 曾封鎖自行編譯的 `TokenTracker.exe`，原因為不符合簽章要求，因此 0.5 已移除該自解壓 EXE 與 C# 啟動器。可攜包唯一的 EXE 是未修改的官方 Node；建置與安裝均核對 OpenJS Foundation 的有效 Authenticode 簽章及逐檔 SHA256。這不代表 TokenTracker 的 JavaScript 有 OpenJS 簽署。參見 [Microsoft 的簽章說明](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview)。

不需要 `.env`，可選顯示參數在面板「設定」內調整。官方頁面訊息介面可能隨 Codex 更新而改變；無法連接時會清楚回報啟動未完成，保留資料。

## 開發、驗證與封裝

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm test:desktop
pnpm package:windows
pnpm test:package
$release = Get-Content release/latest.json -Raw | ConvertFrom-Json
node launcher/install-shortcut.mjs $release.directory
```

`test:desktop` 在官方簽章完整的 Codex 與隔離空白設定中載入面板，使用合成通知驗證模型、串流、Token、任務、操作、重啟與窄視窗；不發送模型請求。測試也檢查官方簽章、EXE／DLL／ASAR 前後雜湊、主畫面信任邊界及監聽狀況。見 [桌面驗收](signed-overlay-evidence.json)、[面板截圖](signed-overlay-hud.png) 與 [浮球](signed-overlay-bubble.png)。

建置產生 `release/<時間>/TokenTracker.zip`，內含官方簽章 Node、單檔伴隨程式、Svelte 面板、TT 圖示、SHA256 清單與授權文件。封裝不含官方 Codex、Playwright、Electron 或 EXE／ASAR 修改工具。安裝時核對逐檔雜湊與 Node 簽章，將完整版本放入新目錄再切換桌面捷徑，不覆寫使用中的程式。最新位置與 ZIP 雜湊見 `release/latest.json`。

`test:package` 解壓實際 ZIP，以內含 Node 啟動官方 Codex，驗證視窗可見、面板已掛載、重複啟動防護、資料保留、退出清理與 Code Integrity 事件。見 [封裝驗收](signed-package-evidence.json)。解壓後也能以 `node.exe app/launcher/install-shortcut.mjs` 安裝桌面捷徑。

本次桌面捷徑更新與原用量檔案雜湊保留結果，見 [安裝驗收](signed-installation.json)。測試只重播合成通知，未發送付費模型請求。

`pnpm desktop:start` 可用專案內的隔離資料位置啟動開發版；先執行 `pnpm build`。正常使用建議使用桌面啟動器，以確保版本與資料位置一致。

## 參考

設計前搜尋並參考 [Playwright 的本機管線傳輸](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/pipeTransport.ts)，實作僅使用 Node 標準庫。沿用 [Svelte](https://github.com/sveltejs/svelte) 與 [lowdb](https://github.com/typicode/lowdb)。官方訊息介面另以 REA 做有限範圍檢查，行為以實際官方 Renderer 驗證為準。

浮球互動參考 [interact.js 的 transform 拖曳](https://github.com/taye/interact.js/blob/main/docs/draggable.md) 與 [Motion 的拖曳門檻／逐幀處理](https://github.com/motiondivision/motion/blob/main/packages/framer-motion/src/gestures/pan/PanSession.ts)，套用於既有 Svelte 5 與內建 Spring，沒有增加拖曳或動畫套件。桌面驗收包含 45 幀位置穩定、滑鼠／觸控／方向鍵、拖曳只寫入一次、拖後不誤點、快速切換及重啟還原。

舊的補丁驗證報告留作歷史紀錄；`firewall-validation.json` 描述的是已移除的 0.4.1 架構限制，不代表 0.5 的啟動結果。
