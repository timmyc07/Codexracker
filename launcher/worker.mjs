import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startTracker, inspectTracker, rollbackTracker } from '../companion/manager.mjs'

export function errorMessage(error) {
  if (error.code === 'EEXIST')
    return 'TokenTracker 已在執行，或另一個啟動程序尚未完成。請先關閉 TokenTracker 啟動的 Codex 再重試。'
  if (['EACCES', 'EPERM'].includes(error.code))
    return '無法存取程式或資料目錄。既有資料已保留，請檢查目前使用者的存取權限。'
  if (error.code === 'ENOSPC') return '磁碟空間不足。既有用量與設定已保留。'
  if (error.message?.includes('No previous'))
    return '尚無上一個已驗證的管線版本可回復。舊的 EXE 補丁版本不會再啟動。'
  return '啟動未完成，既有資料已保留。請確認官方 Windows Codex 已安裝且 Windows 防護允許它執行，再重試。'
}

export async function runAction(
  action,
  root,
  program,
  emit,
  io = { startTracker, inspectTracker, rollbackTracker },
) {
  if (!['diagnose', 'launch', 'sync', 'rollback'].includes(action))
    throw new Error('Unknown action')
  emit({ type: 'progress', message: '正在核對官方 Codex 與 TokenTracker 本機管線…' })
  if (action === 'diagnose' || action === 'sync') {
    const state = await io.inspectTracker(root, program)
    emit({
      ...state,
      type: 'result',
      status: action === 'diagnose' ? 'package-verified' : state.status,
      message: `官方 Codex ${state.version} 已確認。TokenTracker 不修改官方檔案，無需 TCP 除錯連接埠。`,
    })
    return
  }
  const result =
    action === 'rollback'
      ? await io.rollbackTracker(root, program)
      : await io.startTracker(root, program)
  const messages = {
    started: '官方 Codex 已啟動，TokenTracker 會顯示在視窗內。',
    'already-running': 'TokenTracker 已在執行，請使用既有 Codex 視窗。',
    'rolled-back': '已回復上一個管線版本並啟動官方 Codex。',
  }
  emit({ type: 'result', ...result, message: messages[result.status] ?? '檢查完成。' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const emit = (value) => console.log(JSON.stringify(value))
  try {
    const [action, directory] = process.argv.slice(2)
    if (!directory) throw new Error('Expected data directory')
    const root = path.resolve(directory)
    const program = fileURLToPath(new URL('../', import.meta.url))
    const main = await readFile(path.join(program, 'dist/companion.cjs'), 'utf8')
    const page = await readFile(path.join(program, 'dist/page.js'), 'utf8')
    if (
      !main.includes('remote-debugging-pipe') ||
      main.includes('remote-debugging-port') ||
      !page.includes('TokenTrackerPage')
    )
      throw new Error('Invalid tracker bundle')
    await runAction(action, root, program, emit)
  } catch (error) {
    emit({ type: 'result', status: 'failed', message: errorMessage(error) })
    process.exitCode = 1
  }
}
