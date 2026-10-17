import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'vite'
import { chromium } from 'playwright'
import { experimentRoot, workspaceRoot } from './copy-runtime.mjs'
import { prepareProbe, restoreCopy } from './probe-copy.mjs'

/** A real desktop IPC replay test. No turn/start, prompt or login-file copy. */
async function verifyUsageCopy(codexHome, threadId) {
  const bundle = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.join(workspaceRoot, 'injector/usage-probe-entry.ts'),
        name: 'CodexrackerUsage',
        formats: ['iife'],
      },
    },
  })
  const output = Array.isArray(bundle) ? bundle[0].output : bundle.output
  const code = output.find((item) => item.type === 'chunk').code
  const extension = `\n;${code}\n;CodexrackerUsage.installUsageProbe(require('electron').ipcRenderer,require('electron').contextBridge);\n`
  const report = {
    schemaVersion: 1,
    inspectedAt: new Date().toISOString(),
    result: 'failed',
    method: 'managed-copy-preload-IPC-existing-response-replay',
    realModelRequestsSent: false,
    loginFilesCopied: false,
    rawPayloadsPersisted: false,
  }
  let prepared = false
  let child
  let exited
  let browser
  try {
    const state = await prepareProbe('playwright', extension)
    prepared = true
    const run = path.join(experimentRoot, `usage-${randomUUID()}`)
    const profile = path.join(run, 'profile')
    await mkdir(profile, { recursive: true })
    const env = {
      ...process.env,
      CODEX_HOME: path.resolve(codexHome),
      CODEXRACKER_PROBE_PROFILE: profile,
      CODEXRACKER_PROBE_OUTPUT: path.join(run, 'proof.json'),
    }
    delete env.OPENAI_API_KEY
    delete env.ELECTRON_RUN_AS_NODE
    child = spawn(
      path.join(experimentRoot, 'app', 'ChatGPT.exe'),
      [
        `--user-data-dir=${profile}`,
        '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1',
        '--no-first-run',
      ],
      { cwd: path.join(experimentRoot, 'app'), env, windowsHide: true, stdio: 'ignore' },
    )
    exited = new Promise((resolve) => child.once('close', resolve))
    let spawnFailed = false
    child.on('error', () => {
      spawnFailed = true
    })
    const deadline = Date.now() + 30000
    let endpoint
    while (Date.now() < deadline) {
      if (spawnFailed || child.exitCode !== null) throw new Error('copy-start-failed')
      try {
        const [port, target] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
          .trim()
          .split(/\r?\n/)
        if (
          !/^\d+$/.test(port) ||
          +port < 1 ||
          +port > 65535 ||
          !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(target)
        )
          throw new Error('invalid-local-endpoint')
        endpoint = `ws://127.0.0.1:${port}${target}`
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await delay(100)
    }
    if (!endpoint) throw new Error('no-CDP-endpoint')
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 })
    let page
    while (Date.now() < deadline) {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith('app:'))
      if (page) break
      await delay(100)
    }
    if (!page) throw new Error('no-app-renderer')
    await page.waitForFunction(
      (nonce) =>
        window.codexrackerProbe?.nonce === nonce &&
        window.codexrackerUsageProbe != null &&
        window.electronBridge != null,
      state.nonce,
      { timeout: 15000 },
    )
    const authKind = await page.evaluate(async () => {
      const id = 'codexracker-account-probe'
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          window.removeEventListener('message', listener)
          resolve('timeout')
        }, 15000)
        const listener = (event) => {
          if (event.data?.type !== 'mcp-response' || event.data.message?.id !== id) return
          clearTimeout(timer)
          window.removeEventListener('message', listener)
          const type = event.data.message.result?.account?.type
          resolve(type === 'chatgpt' || type === 'apiKey' ? type : 'unknown')
        }
        window.addEventListener('message', listener)
        window.electronBridge.sendMessageFromView({
          type: 'mcp-request',
          hostId: 'local',
          request: { id, method: 'account/read', params: { refreshToken: false } },
        })
      })
    })
    report.accountKind = authKind
    await page.evaluate(
      (threadId) =>
        window.electronBridge.sendMessageFromView({
          type: 'mcp-request',
          hostId: 'local',
          request: {
            id: 'codexracker-usage-replay',
            method: 'thread/resume',
            params: { threadId, excludeTurns: true },
          },
        }),
      threadId,
    )
    await page.waitForFunction(
      () => window.codexrackerUsageProbe.snapshot().notificationCount > 0,
      null,
      { timeout: 15000 },
    )
    report.probe = await page.evaluate(() => window.codexrackerUsageProbe.snapshot())
    report.pageProtocol = 'app:'
    report.result =
      authKind === 'chatgpt' && report.probe.latestUsage?.inputTokens !== undefined
        ? 'passed'
        : 'failed'
    await page.evaluate(() => window.codexrackerProbe.finish())
    await Promise.race([exited, delay(3000)])
  } catch {
    // Keep diagnostics categorical: browser errors can embed application content.
    report.failure = 'desktop-usage-probe-did-not-complete'
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (child?.exitCode === null && child.pid)
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
    if (exited) await exited
    if (prepared) {
      await restoreCopy()
      report.managedCopyRestored = true
    }
  }
  return report
}

const [codexHome, threadId] = process.argv.slice(2)
if (!codexHome || !threadId) throw new Error('Expected existing Codex home and inactive thread ID')
const report = await verifyUsageCopy(codexHome, threadId)
await writeFile(
  path.join(workspaceRoot, 'phase-two-desktop-evidence.json'),
  `${JSON.stringify(report, null, 2)}\n`,
)
console.log(JSON.stringify(report, null, 2))
if (report.result !== 'passed') process.exitCode = 1
