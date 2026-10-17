import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractFile } from '@electron/asar'
import { hashFile } from './copy-runtime.mjs'

/** Record code markers and numeric usage only, never app-server payloads or stderr. */
export async function inspectUsage(executable, archive, threadId, output) {
  const code = (file) => extractFile(archive, path.join('.vite', 'build', file)).toString()
  const preload = code('preload.js')
  const main = code('src-DCNiwad_.js')
  const transport = code('application-network-startup-YSC7OAs0.js')
  const markers = {
    ipcChannel: preload.includes('codex_desktop:message-for-view'),
    mainEnvelope: main.includes(
      'type:`mcp-notification`,hostId:this.options.hostId,method:e.method',
    ),
    tokenUsageMethod: main.includes('thread/tokenUsage/updated'),
    localStdioTransport: transport.includes('this.kind=`stdio`,new Gs('),
  }
  if (!Object.values(markers).every(Boolean))
    throw new Error('Unsupported desktop transport structure')
  const report = {
    schemaVersion: 1,
    inspectedAt: new Date().toISOString(),
    result: 'not-observed',
    archiveSha256: await hashFile(archive),
    staticChannelEvidence: markers,
    observation: 'bundled-app-server-stdio-resume-existing-thread-excludeTurns',
    realModelRequestsSent: false,
    rawPayloadsPersisted: false,
    exitCode: null,
    rpcErrorCode: null,
    notifications: [],
  }
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env },
  })
  let settled = false
  let timer
  const result = await new Promise((resolve) => {
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdin.end()
      resolve(report)
    }
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
    child.on('error', () => {
      report.failure = 'spawn-error'
      finish()
    })
    child.on('exit', (code) => {
      report.exitCode = code
      finish()
    })
    child.stdin.on('error', finish)
    timer = setTimeout(finish, 20000)
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', (line) => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.error) {
        report.rpcErrorCode = message.error.code
        report.failure = message.id === 1 ? 'initialize-rejected' : 'resume-rejected'
        const reason = String(message.error.message ?? '')
        report.failureCategory = [
          'not found',
          'not loaded',
          'initialized',
          'capability',
          'originator',
          'Invalid request',
          'invalid type',
          'missing field',
          'permission',
          'ephemeral',
          'paginated',
          'active writer',
        ].filter((term) => reason.toLowerCase().includes(term.toLowerCase()))
        finish()
      }
      if (message.id === 1 && message.result) {
        send({ method: 'initialized' })
        send({ id: 2, method: 'thread/resume', params: { threadId, excludeTurns: true } })
      }
      if (message.id === 2 && message.error) finish()
      if (message.method !== 'thread/tokenUsage/updated' || message.params?.threadId !== threadId)
        return
      const numeric = (value) =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
      const pick = (value) => ({
        inputTokens: numeric(value?.inputTokens),
        outputTokens: numeric(value?.outputTokens),
        cachedInputTokens: numeric(value?.cachedInputTokens),
        totalTokens: numeric(value?.totalTokens),
      })
      report.notifications.push({
        method: message.method,
        total: pick(message.params.tokenUsage?.total),
        last: pick(message.params.tokenUsage?.last),
      })
      report.result = 'observed'
      finish()
    })
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'codexracker_usage_probe', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      },
    })
  })
  child.kill()
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [executable, archive, threadId, output] = process.argv.slice(2)
  if (!executable || !archive || !threadId || !output)
    throw new Error('Expected executable, archive, existing thread ID, output path')
  const result = await inspectUsage(executable, archive, threadId, output)
  console.log(JSON.stringify(result, null, 2))
  if (result.result !== 'observed') process.exitCode = 1
}
