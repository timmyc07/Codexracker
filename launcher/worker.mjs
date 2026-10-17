import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { synchronize, startDesktop, rollback, readProcesses } from '../injector/runtime-manager.mjs'

export const statusMessages = {
  'defer-running-app':
    '請完整退出原 Codex App 與追蹤副本（包含背景程序），再按「啟動 Codex」。目前沒有關閉任何 App。',
  'defer-unstable-source': 'Codex 安裝來源正在變動，請待商店更新完成後重試。',
  'defer-failed-build': '此版本曾驗證失敗，保留既有可用版本。若有可用副本，將啟動該副本。',
  'defer-rolled-back-build': '已保留手動回復的版本，將啟動目前可用副本。',
  activated: '追蹤副本已準備完成。',
  current: '追蹤副本已通過檢查。',
  started: 'Codex 已啟動。用量 HUD 會顯示在 Codex 視窗內。',
  'rolled-back': '已回復上一個可用版本。',
}

export function errorMessage(error) {
  if (error.code === 'UNKNOWN')
    return 'Windows 拒絕啟動 Codex 副本。請檢查 Windows 安全性與程式碼完整性事件；若簽章原則阻擋修改過的 EXE，需受信任的程式碼簽章或改用不修改 EXE 的架構。既有資料已保留，開放防火牆無法修復簽章問題。'
  if (error.code === 'EEXIST')
    return '另一個管理程序正在執行，或上次意外結束留下鎖。請先確認其他啟動器已關閉；鎖檔不會被自動移除。'
  if (['EACCES', 'EPERM'].includes(error.code))
    return '無法存取程式或資料目錄。請確認目前使用者具有存取權限後重試。'
  if (error.code === 'ENOSPC') return '磁碟空間不足。首次準備完整 Codex 副本需要約 3 GB 可用空間。'
  if (error.message?.includes('No previous')) return '尚無上一個通過驗證的版本可回復。'
  if (error.message?.includes('No verified'))
    return '尚無通過驗證的副本。請先關閉原 Codex App，再按「啟動 Codex」準備副本。'
  if (error.message?.includes('registered') || error.message?.includes('package'))
    return '無法確認 Codex 商店安裝。請先安裝並啟動官方 Windows Codex App，再重試。'
  return '處理未完成，既有版本與資料已保留。請確認官方 Codex 安裝完整、所有 Codex App 已退出，再重試。'
}

export async function runAction(
  action,
  root,
  extensions,
  emit,
  io = { synchronize, startDesktop, rollback, readProcesses },
) {
  if (action === 'diagnose') {
    if (
      !extensions.main.includes('installDesktopMain') ||
      !extensions.preload.includes('installDesktopPreload')
    )
      throw new Error('Missing desktop bundles')
    emit({
      type: 'result',
      status: 'package-verified',
      message: '內含執行環境、模組與桌面產物均可載入。',
      processes: await io.readProcesses(root),
    })
    return
  }
  if (!['launch', 'sync', 'rollback'].includes(action)) throw new Error('Unknown action')
  emit({
    type: 'progress',
    message:
      action === 'rollback'
        ? '正在驗證上一個可用版本…'
        : '正在檢查 Codex 安裝。首次準備副本可能需要數分鐘…',
  })
  const result =
    action === 'rollback' ? await io.rollback(root) : await io.synchronize(root, extensions)
  emit({
    type: 'progress',
    status: result.status,
    message: statusMessages[result.status] ?? '檢查完成。',
  })
  if (['defer-running-app', 'defer-unstable-source'].includes(result.status)) {
    emit({ type: 'result', status: result.status, message: statusMessages[result.status] })
    return
  }
  if (action === 'sync') {
    emit({ type: 'result', status: result.status, message: statusMessages[result.status] })
    return
  }
  const started = await io.startDesktop(root)
  emit({
    type: 'result',
    status: started.status,
    message: statusMessages[started.status] ?? '啟動完成。',
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const emit = (value) => console.log(JSON.stringify(value))
  try {
    const [action, root] = process.argv.slice(2)
    if (!root || !path.isAbsolute(root)) throw new Error('Expected absolute data directory')
    const app = fileURLToPath(new URL('../', import.meta.url))
    const extensions = {
      main: await readFile(path.join(app, 'dist/desktop-main.cjs'), 'utf8'),
      preload: await readFile(path.join(app, 'dist/desktop-preload.cjs'), 'utf8'),
    }
    await runAction(action, root, extensions, emit)
  } catch (error) {
    emit({ type: 'result', status: 'failed', message: errorMessage(error) })
    process.exitCode = 1
  }
}
