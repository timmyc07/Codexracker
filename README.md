# Codexracker

Windows Codex 桌面版的 Token 與快取用量追蹤專案。

目前為 TypeScript / Svelte / lowdb 骨架，尚未完成實際注入驗收。

## 實作順序

1. 驗證目標安裝、最小注入與備份還原。
2. 確認實際請求通道，解析逐段 SSE 用量。
3. 實作 HUD、本機用量紀錄與管理區費率。
4. 驗證真實請求 E2E 與更新後補丁。

第一階段未通過時，停止依賴注入的後續階段。目前 WindowsApps 安裝的 ASAR 可讀，但目前執行身分沒有修改權限。詳見 [探勘報告](feasibility-report.json)。

已確認 ASAR 入口為 `.vite/build/early-bootstrap.js`，並找到三個 Preload 候選檔。套件使用 `owl` runtime；官方 Fuses 工具未能在桌面執行檔讀到標準識別標記，完整性設定仍屬未知。詳見 [唯讀檢查輸出](installation-inspection.json)。找到入口或 Preload 檔案不代表已成功注入。

## 第一階段檢查

需要 Node.js 22.12 以上與 pnpm。安裝依賴後執行：

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm inspect:installation 'C:\Program Files\WindowsApps\OpenAI.Codex_26.1007.9446.0_x64__2p2nqsd0c76g0'
pnpm test:inspection
pnpm lint
pnpm test
pnpm build
```

檢查工具僅讀取指定套件，向標準輸出回傳 JSON；不啟動 App、不修改安裝檔，也不發送請求。安裝更新後請傳入新的套件根目錄。結束碼 0 表示檢查完成，是否通過必須看 JSON 的 `result`；目前固定回報 `blocked`，因為本工具沒有執行寫入、注入與還原驗收。結束碼 1 表示檢查失敗。

測試以暫存的 ASAR 驗證入口檢查、路徑限制、指紋不變與無法讀取 Fuses 時保留未知狀態。測試通過不代表目標 App 可注入。

`test:e2e` 仍是未完成的骨架，不能作為真實請求或本機安裝啟動成功的證據。

只保存正規化用量，不保存提示詞或回應本文。成本按管理區模型費率估算，不代表官方帳單。

環境變數只放執行所必需的值；其餘可選設定放在管理區。
