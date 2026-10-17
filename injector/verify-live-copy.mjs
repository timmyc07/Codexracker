import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildDesktopExtensions } from './build-desktop.mjs'
import { experimentRoot, workspaceRoot } from './copy-runtime.mjs'
import { desktopSession } from './desktop-session.mjs'
import { prepareProbe, restoreCopy } from './probe-copy.mjs'
import { verifyRestoration } from './verify-restoration.mjs'

const [codexHome] = process.argv.slice(2)
if (!codexHome) throw new Error('Expected an existing logged-in Codex home')
const report = {
  schemaVersion: 1,
  inspectedAt: new Date().toISOString(),
  result: 'failed',
  method: 'Playwright-real-desktop-IPC-new-model-turns',
  realModelRequestsSent: 0,
  realStoreUpdatePerformed: false,
  loginFilesCopied: false,
  rawPayloadsPersisted: false,
  firstTurnPolicy: 'baseline-only; compare second turn against observed cumulative baseline',
}
const run = path.join(experimentRoot, `live-${randomUUID()}`)
const profile = path.join(run, 'profile')
await mkdir(run)
let prepared = false
let step = 'build'
try {
  const extensions = await buildDesktopExtensions()
  const numericProbe = `\n;(() => {
    const {ipcRenderer,contextBridge}=require('electron')
    let threadId, latest, completed=0, started=0, errors=0, failureCategory
    const numeric=n=>Number.isSafeInteger(n)&&n>=0?n:null
    ipcRenderer.on('codex_desktop:message-for-view',(_event,message)=>{
      if(message?.type!=='mcp-notification'||message.params?.threadId!==threadId)return
      if(message.method==='turn/started')started++
      if(message.method==='turn/completed')completed++
      if(message.method==='error'){
        errors++
        const reason=String(message.params?.error?.message??'').toLowerCase()
        failureCategory=['auth','network','connect','rate limit','quota','model','not supported'].filter(term=>reason.includes(term))
      }
      if(message.method==='thread/tokenUsage/updated'){
        const total=message.params.tokenUsage?.total
        latest={inputTokens:numeric(total?.inputTokens),outputTokens:numeric(total?.outputTokens),promptCacheHitTokens:numeric(total?.cachedInputTokens)}
      }
    })
    contextBridge.exposeInMainWorld('codexrackerLiveProbe',{
      begin:id=>{threadId=id},snapshot:()=>({latest,completed,started,errors,failureCategory})
    })
  })();\n`
  step = 'prepare'
  await prepareProbe('playwright', extensions.preload + numericProbe, extensions.main)
  prepared = true
  step = 'live-desktop'
  await desktopSession(
    path.join(experimentRoot, 'app'),
    profile,
    path.resolve(codexHome),
    async (page) => {
      await page.waitForFunction(() => !!window.electronBridge)
      const progress = setInterval(() => {
        void page
          .evaluate(() => window.codexrackerLiveProbe.snapshot())
          .then(
            (observation) =>
              console.log(JSON.stringify({ stage: 'awaiting-live-usage', observation })),
            () => {},
          )
      }, 15000)
      // Only numeric usage and categorical status leave this evaluation. No responses or RPC errors.
      let result
      try {
        result = await page.evaluate(async (cwd) => {
          const requests = new Map()
          let sequence = 0
          let threadId
          let latest
          let sent = 0
          const cleanup = { threadArchived: false }
          const listener = (event) => {
            const envelope = event.data
            if (envelope?.type === 'mcp-response') {
              const message = envelope.message
              const pending = requests.get(message?.id)
              if (pending) {
                requests.delete(message.id)
                clearTimeout(pending.timer)
                if (message.error) pending.reject(new Error('rpc-rejected'))
                else pending.resolve(message.result)
              }
            }
          }
          window.addEventListener('message', listener)
          const rpc = (method, params) =>
            new Promise((resolve, reject) => {
              const id = `codexracker-live-${++sequence}`
              const timer = setTimeout(() => {
                requests.delete(id)
                reject(new Error('rpc-timeout'))
              }, 30000)
              requests.set(id, { resolve, reject, timer })
              window.electronBridge.sendMessageFromView({
                type: 'mcp-request',
                hostId: 'local',
                request: { id, method, params },
              })
            })
          const wait = async (predicate) => {
            const deadline = Date.now() + 120000
            while (!(await predicate())) {
              if (Date.now() > deadline) throw new Error('turn-timeout')
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
          }
          try {
            const account = await rpc('account/read', { refreshToken: false })
            if (account.account?.type !== 'chatgpt')
              return { result: 'failed', failure: 'logged-in-account-unavailable', sent, cleanup }
            const started = await rpc('thread/start', {
              cwd,
              ephemeral: false,
              approvalPolicy: 'never',
              sandbox: 'read-only',
            })
            threadId = started.thread.id
            window.codexrackerLiveProbe.begin(threadId)
            const turn = async () => {
              const before = window.codexrackerLiveProbe.snapshot().completed
              sent++
              await rpc('turn/start', {
                threadId,
                effort: 'low',
                input: [
                  {
                    type: 'text',
                    text: 'This is a token accounting smoke test. Reply only with OK. Do not use tools or inspect any files.',
                  },
                ],
              })
              await wait(() => {
                const observed = window.codexrackerLiveProbe.snapshot()
                latest = observed.latest
                return observed.completed > before
              })
              await wait(() => window.codexrackerLiveProbe.snapshot().latest != null)
            }
            await turn()
            const baseline = { ...latest }
            const before = await window.codexracker.snapshot()
            await turn()
            const delta = Object.fromEntries(
              Object.keys(baseline).map((key) => [
                key,
                baseline[key] !== null && latest[key] !== null ? latest[key] - baseline[key] : null,
              ]),
            )
            await wait(
              async () =>
                (await window.codexracker.snapshot()).total.usageUpdateCount >
                before.total.usageUpdateCount,
            )
            const after = await window.codexracker.snapshot()
            const equal = Object.keys(delta).every(
              (key) =>
                delta[key] !== null &&
                (after.total[key] ?? 0) - (before.total[key] ?? 0) === delta[key],
            )
            return {
              result:
                equal && delta.inputTokens > 0 && delta.outputTokens > 0 ? 'passed' : 'failed',
              sent,
              cleanup,
              observation: window.codexrackerLiveProbe.snapshot(),
              baseline,
              secondTurnDelta: delta,
              totals: after.total,
              last: after.latest,
              usageUpdateCount: after.total.usageUpdateCount,
              cacheHitObserved: delta.promptCacheHitTokens > 0,
            }
          } catch (error) {
            return {
              result: 'failed',
              sent,
              cleanup,
              observation: window.codexrackerLiveProbe.snapshot(),
              failure: ['rpc-rejected', 'rpc-timeout', 'turn-timeout'].includes(error.message)
                ? error.message
                : 'live-check-failed',
            }
          } finally {
            const observation = window.codexrackerLiveProbe.snapshot()
            if (
              threadId &&
              observation.completed > 0 &&
              observation.started === observation.completed
            ) {
              await rpc('thread/archive', { threadId }).then(
                () => {
                  cleanup.threadArchived = true
                },
                () => {},
              )
            }
            window.removeEventListener('message', listener)
            for (const pending of requests.values()) clearTimeout(pending.timer)
          }
        }, run)
      } finally {
        clearInterval(progress)
      }
      report.realModelRequestsSent = result.sent
      report.live = result
      if (result.result !== 'passed') throw new Error('live-check-failed')
      const hud = page.locator('codex-token-cache-hud')
      await hud.getByTestId('total-input').waitFor()
      const text = await hud.getByTestId('total-input').textContent()
      if (text.replaceAll(',', '') !== String(result.totals.inputTokens))
        throw new Error('hud-total-mismatch')
      report.hudMatchesSnapshot = true
    },
  )
  step = 'persistence'
  const data = JSON.parse(await readFile(path.join(profile, 'codexracker/metrics.json'), 'utf8'))
  if (
    data.records.length !== report.live.usageUpdateCount ||
    data.records.some((record) =>
      Object.keys(record).some(
        (key) =>
          ![
            'recordedAt',
            'inputTokens',
            'outputTokens',
            'promptCacheHitTokens',
            'model',
            'provider',
            'serviceTier',
          ].includes(key),
      ),
    )
  )
    throw new Error('persistence-boundary-failed')
  for (const field of ['inputTokens', 'outputTokens', 'promptCacheHitTokens']) {
    if (data.records.reduce((sum, record) => sum + record[field], 0) !== report.live.totals[field])
      throw new Error('persisted-totals-mismatch')
  }
  report.persistedTotalsMatch = true
  report.persistedRecordCount = data.records.length
  report.result = 'passed'
} catch {
  report.failureStep = step
} finally {
  if (prepared) {
    try {
      await restoreCopy()
      const restoration = await verifyRestoration()
      await writeFile(
        path.join(workspaceRoot, 'phase-four-restoration.json'),
        JSON.stringify(restoration, null, 2) + '\n',
      )
      report.restoration = restoration.result
      if (restoration.result !== 'passed') report.result = 'failed'
    } catch {
      report.restoration = 'failed'
      report.result = 'failed'
    }
  }
  await writeFile(
    path.join(workspaceRoot, 'phase-four-live-evidence.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
}
console.log(JSON.stringify(report, null, 2))
if (report.result !== 'passed') process.exitCode = 1
