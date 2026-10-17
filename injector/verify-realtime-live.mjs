import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildDesktopExtensions } from './build-desktop.mjs'
import { desktopSession } from './desktop-session.mjs'
import { experimentRoot, workspaceRoot } from './copy-runtime.mjs'
import { prepareProbe, restoreCopy } from './probe-copy.mjs'
import { verifyRestoration } from './verify-restoration.mjs'

const [codexHome] = process.argv.slice(2)
if (!codexHome) throw new Error('Expected existing logged-in Codex home')
const run = path.join(experimentRoot, `realtime-live-${randomUUID()}`)
await mkdir(run)
const report = {
  testedAt: new Date().toISOString(),
  result: 'failed',
  method: 'real-desktop-stream-quota-model',
  realModelRequestsSent: 0,
  rawPayloadsPersisted: false,
}
let prepared = false
try {
  const extensions = await buildDesktopExtensions()
  await prepareProbe('playwright', extensions.preload, extensions.main)
  prepared = true
  await desktopSession(
    path.join(experimentRoot, 'app'),
    path.join(run, 'profile'),
    path.resolve(codexHome),
    async (page) => {
      const evidence = await page.evaluate(async (cwd) => {
        let sequence = 0
        let threadId
        let sent = 0
        let archived = false
        const pending = new Map()
        const observed = { streamUpdates: 0, progressBeforeFinalTokens: false }
        const unsubscribe = window.codexracker.subscribeLive((state) => {
          if (state.run.status === 'streaming') {
            observed.streamUpdates++
            if (state.run.outputCharacters > 0 && state.run.measured.outputTokens === undefined)
              observed.progressBeforeFinalTokens = true
          }
        })
        const listener = (event) => {
          if (event.data?.type !== 'mcp-response') return
          const message = event.data.message
          const request = pending.get(message?.id)
          if (!request) return
          pending.delete(message.id)
          clearTimeout(request.timer)
          if (message.error) request.reject(new Error('RPC-failed'))
          else request.resolve(message.result)
        }
        window.addEventListener('message', listener)
        const rpc = (method, params) =>
          new Promise((resolve, reject) => {
            const id = `codexracker-realtime-${++sequence}`
            const timer = setTimeout(() => {
              pending.delete(id)
              reject(new Error('RPC-timeout'))
            }, 30000)
            pending.set(id, { timer, resolve, reject })
            window.electronBridge.sendMessageFromView({
              type: 'mcp-request',
              hostId: 'local',
              request: { id, method, params },
            })
          })
        let result
        try {
          const account = await rpc('account/read', { refreshToken: false })
          if (account.account?.type !== 'chatgpt') throw new Error('logged-in-account-required')
          await window.codexracker.refreshLimits()
          const quota = await window.codexracker.liveSnapshot()
          const started = await rpc('thread/start', {
            cwd,
            ephemeral: false,
            approvalPolicy: 'never',
            sandbox: 'read-only',
          })
          threadId = started.thread.id
          sent++
          await rpc('turn/start', {
            threadId,
            effort: 'low',
            input: [
              {
                type: 'text',
                text: 'Reply with numbers 1 through 40 separated by spaces. Do not use tools or inspect files.',
              },
            ],
          })
          const deadline = Date.now() + 120000
          let live
          do {
            live = await window.codexracker.liveSnapshot()
            if (['failed', 'interrupted'].includes(live.run.status))
              throw new Error('turn-not-completed')
            if (live.run.status === 'completed' && live.run.measured.outputTokens !== undefined)
              break
            await new Promise((resolve) => setTimeout(resolve, 100))
          } while (Date.now() < deadline)
          result = {
            result:
              live.run.status === 'completed' &&
              observed.progressBeforeFinalTokens &&
              live.weekly !== null &&
              live.run.model === started.model &&
              live.run.provider === started.modelProvider
                ? 'passed'
                : 'failed',
            sent,
            observed,
            live,
            quotaBeforeTurn: { weekly: quota.weekly, limitsStatus: quota.limitsStatus },
            resolvedModel: started.model,
            resolvedProvider: started.modelProvider,
          }
          if (live.run.status === 'completed')
            await rpc('thread/archive', { threadId }).then(
              () => {
                archived = true
              },
              () => {},
            )
        } catch (error) {
          result = {
            result: 'failed',
            sent,
            observed,
            failure: [
              'RPC-failed',
              'RPC-timeout',
              'logged-in-account-required',
              'turn-not-completed',
            ].includes(error.message)
              ? error.message
              : 'live-check-incomplete',
          }
        } finally {
          unsubscribe()
          window.removeEventListener('message', listener)
          for (const request of pending.values()) clearTimeout(request.timer)
        }
        return { ...result, testThreadArchived: archived }
      }, run)
      report.realModelRequestsSent = evidence.sent
      report.evidence = evidence
      report.result = evidence.result
      await page
        .locator('codex-token-cache-hud')
        .locator('section')
        .screenshot({ path: path.join(workspaceRoot, 'realtime-live-hud.png') })
    },
  )
} catch {
  report.result = 'failed'
  report.failure = 'desktop-check-incomplete'
} finally {
  if (prepared) {
    try {
      await restoreCopy()
      const restoration = await verifyRestoration()
      report.restoration = restoration.result
      await writeFile(
        path.join(workspaceRoot, 'realtime-live-restoration.json'),
        JSON.stringify(restoration, null, 2) + '\n',
      )
      if (restoration.result !== 'passed') report.result = 'failed'
    } catch {
      report.restoration = 'failed'
      report.result = 'failed'
    }
  }
  await writeFile(
    path.join(workspaceRoot, 'realtime-live-evidence.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
}
console.log(JSON.stringify(report, null, 2))
if (report.result !== 'passed') process.exitCode = 1
