import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { spawn } from 'node:child_process'
import { runAction, errorMessage } from './worker.mjs'

if (!process.argv[2] || !path.isAbsolute(process.argv[2]))
  throw new Error('Expected data directory')
const root = process.argv[2]
const program = fileURLToPath(new URL('../', import.meta.url))
process.title = 'TokenTracker'
console.log('TT · TokenTracker\n官方 Codex 本機追蹤器\n')
async function action(name) {
  try {
    await runAction(name, root, program, (event) => console.log(event.message))
  } catch (error) {
    console.log(errorMessage(error))
  }
}
await action('launch')
const input = createInterface({ input: process.stdin, output: process.stdout })
try {
  while (true) {
    console.log('\n1 啟動 Codex　2 檢查更新　3 回復上一版　4 開啟資料夾　5 關閉選單')
    console.log('關閉此選單後，Codex 與追蹤功能仍會繼續運作。')
    const choice = (await input.question('請輸入 1–5：')).trim()
    if (choice === '5') break
    if (choice === '4') {
      const explorer = spawn('explorer.exe', [root], {
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
      })
      explorer.once('error', () => console.log('無法開啟資料夾。'))
      explorer.unref()
    } else if (['1', '2', '3'].includes(choice))
      await action({ 1: 'launch', 2: 'sync', 3: 'rollback' }[choice])
  }
} finally {
  input.close()
}
