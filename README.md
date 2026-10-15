# Codexracker

Windows Codex 桌面版的 Token 與快取用量追蹤專案。

目前為 TypeScript / Svelte / lowdb 骨架。第一階段已在目前 Windows Owl runtime 的可寫副本驗證最小注入、Playwright Renderer 控制與逐位元還原，並確認更新來源與副本重建方式。Token 攔截、HUD 接線、真實請求 E2E 與自動更新補丁尚未完成。

## 實作順序

1. 驗證目標安裝、最小注入與備份還原。
2. 確認實際請求通道，解析逐段 SSE 用量。
3. 實作 HUD、本機用量紀錄與管理區費率。
4. 驗證真實請求 E2E 與更新後補丁。

目前 WindowsApps 安裝的 ASAR 可讀，但目前執行身分沒有修改權限。依使用者授權，實驗改在工作區的可寫副本執行；沒有改寫原安裝。詳見 [探勘報告](feasibility-report.json) 與 [注入實驗結果](injection-probe-report.json)。

ASAR 入口為 `.vite/build/early-bootstrap.js`，主頁 Preload 為 `.vite/build/preload.js`。Owl 的 Fuses 位於 `chrome.dll`；目前已啟用 `EnableEmbeddedAsarIntegrityValidation` 與 `OnlyLoadAppFromAsar`。`ChatGPT.exe` 嵌有 `resources\\app.asar` 的 SHA256 標頭雜湊。雜湊不符的副本已實際被 runtime 拒絕啟動；更新副本中的預期雜湊後，真實 App 的 `app:` Renderer 成功讀取 Preload 標記。詳見 [唯讀檢查輸出](installation-inspection.json)。

修改副本中執行檔的雜湊記錄會使其原廠 Authenticode 簽章失效。實驗沒有關閉完整性驗證、修改 Fuses、變更 WindowsApps 權限、註冊 MSIX、安裝憑證或複製登入資料。這次驗證涵蓋新設定檔啟動與 Renderer 控制，不代表登入、完整後端操作或實際商店升級已通過。

## 第一階段檢查

需要 Node.js 22.12 以上與 pnpm。安裝依賴後執行：

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm inspect:installation 'C:\Program Files\WindowsApps\OpenAI.Codex_26.1007.9446.0_x64__2p2nqsd0c76g0'
pnpm test:inspection
pnpm test:launch
pnpm inspect:update
pnpm lint
pnpm test
pnpm build
```

檢查工具僅讀取指定套件，向標準輸出回傳 JSON；不啟動 App、不修改安裝檔，也不發送請求。安裝更新後請傳入新的套件根目錄。結束碼 0 表示檢查完成，是否通過必須看 JSON 的 `result`；目前固定回報 `blocked`，因為本工具沒有執行寫入、注入與還原驗收。結束碼 1 表示檢查失敗。

測試以暫存的 ASAR 驗證入口檢查、路徑限制、指紋不變與無法讀取 Fuses 時保留未知狀態。測試通過不代表目標 App 可注入。

## 在可寫副本重跑實驗

首次複製需要約 2.32 GB，會核對所有檔案雜湊，且拒絕覆寫既有副本。副本、原廠二進位、備份、原始日誌及隔離設定檔均放在 Git 忽略的 `.local-runtime/owl-probe/`；不要將該目錄加入 Git。

```powershell
# 首次建立副本；現有副本已建立時略過這一步
node injector/copy-runtime.mjs 'C:/Program Files/WindowsApps/OpenAI.Codex_26.1007.9446.0_x64__2p2nqsd0c76g0/app'

# application 只追加主程序診斷監聽器及 Preload 標記，保留原有 App 邏輯
node injector/probe-copy.mjs application
node injector/run-probe.mjs
node injector/probe-copy.mjs restore
node injector/verify-restoration.mjs
```

`harness` 模式會暫時以最小診斷 App 取代副本的 ASAR，用來隔離測試 runtime；它不等同於真實 App 驗收。可在準備 `harness` 後執行 `node injector/run-probe.mjs mismatch` 驗證原執行檔會拒絕新的 ASAR，再執行正常測試與還原。

每個準備好的實驗各允許一次正常啟動與一次雜湊不符啟動，以免覆寫證據。準備下一次實驗前必須先還原。重複套用會在寫入前拒絕，不會追加第二份注入。還原會先驗證備份與副本指紋，遇到不認識的修改會保留檔案並報錯。修改前會確認副本未執行；實驗不會關閉原 App。

測試啟動使用全新 `--user-data-dir` 與隔離 `CODEX_HOME`，在 Main 中確認設定檔路徑後才繼續。它會自動退出；20 秒逾時時只終止本次啟動的程序樹。`run-probe` 結束碼 0 表示已保存測試結果，成功與否須檢查回傳 JSON 的 `proof.result`，雜湊不符測試則檢查 `asarIntegrityFailureObserved`。

目前副本已還原。全檔核對結果見 [還原驗證](restoration-verification.json)。自動更新與已登入設定檔的使用另需驗收。

此方案參考了 [Codex RTL 的可寫副本與雜湊更新流程](https://github.com/aviad-benhamo/tool-codex-rtl-patch)；ASAR 操作使用 [官方 @electron/asar](https://github.com/electron/asar)，Fuses 讀取使用 [官方 @electron/fuses](https://github.com/electron/fuses)。沒有執行第三方安裝器。

`test:launch` 是實機啟動測試，不送出模型請求；真實請求 E2E 留到第四階段。

## Playwright 啟動驗證

`pnpm test:launch` 會準備診斷注入、以 Node 啟動副本、用 Playwright `chromium.connectOverCDP` 連到副本設定檔產生的本機端點，驗證真實 `app:` 頁面的 Preload 與 DOM 標記，並實際點擊一個暫時加入的測試按鈕。測試結束後關閉副本、還原並核對全部原始檔案。此命令需要已建立且已還原的實驗副本。

目前 `_electron.launch` 實測在 10 秒逾時，未取得可控制的 ElectronApplication；Owl 的 `EnableNodeCliInspectArguments` 為關閉狀態，而 Playwright 原生 Electron 啟動使用 `--inspect=0`。保留原 Fuses，採用已實測通過的 Renderer CDP 控制。它不提供 Playwright Electron 主程序 API。參見 [Playwright Electron 文件](https://playwright.dev/docs/api/class-electron) 與 [實機啟動結果](playwright-cdp-launch.json)。

## 更新方式驗證

目前註冊的 `OpenAI.Codex` 是 Store 簽章套件，狀態為 `Ok`。原 App 的 Windows 更新程式同時包含商店路徑與原生 MSIX 更新路徑，兩者初始化都要求目前套件身分。唯讀更新檢查回報 `up_to_date`，沒有下載或安裝更新。

可寫副本實測 `windows-updater.node.getCurrentPackageFamily()` 回傳 `null`，不具原套件的更新身分。因此選定的更新流程是：原安裝完成更新後，讀取新的註冊套件位置，確認來源指紋穩定且原 App 與副本均已關閉，再從同版本完整 runtime 建立新副本、重新注入並更新該副本的預期 ASAR 雜湊；驗證通過後才切換，保留上一份副本以便還原。

`pnpm inspect:update` 唯讀查詢註冊套件，連續核對兩次 ASAR、啟動執行檔、`chrome.dll` 與更新原生模組的指紋，再與複製時記錄的原版基準比較。它不以已注入副本的指紋判斷商店更新，也不執行重建。來源變動時，本命令保守回報延後；真正的重建程序仍須檢查執行狀態。

更新判斷的測試涵蓋版本／路徑變更、同版本 ASAR 替換、僅原生 runtime 變更、來源不穩定，以及任一 App 執行時延後。這些是模擬變更測試；目前沒有可用的新版本，尚未發生實際商店升級。自動監看、切換、重新補丁與失敗回復屬於第四階段，不能將本次機制驗證當作其完成證據。詳見 [來源指紋](update-source-inspection.json) 與 [第一階段驗收](phase-one-validation.json)。

只保存正規化用量，不保存提示詞或回應本文。成本按管理區模型費率估算，不代表官方帳單。

環境變數只放執行所必需的值；其餘可選設定放在管理區。
