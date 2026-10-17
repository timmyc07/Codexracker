import path from 'node:path'
import { channels } from '../src/bridge'
import { metricsRepository } from '../src/storage/metrics-db'
import { hasMetrics, objectFrom, sanitizeMetrics, tokenNumber } from '../src/interceptor/usage'
import type { Dashboard } from '../src/overlay/summary'
import type { UsageMetrics } from '../src/interceptor/usage'
import { emptyLive, identifier, sanitizeLive } from '../src/interceptor/live'

interface Contents {
  isDestroyed(): boolean
  send(channel: string, value: unknown): void
  mainFrame: unknown
  executeJavaScript(code: string): Promise<unknown>
  on(event: string, listener: () => void): void
}
interface IpcEvent {
  sender: Contents
  senderFrame: { url: string } | null
}
interface Desktop {
  app: {
    getPath(name: string): string
    on(event: string, listener: (event: unknown, contents: Contents) => void): void
  }
  ipcMain: {
    on(channel: string, listener: (event: IpcEvent, value: unknown) => void): void
    handle(channel: string, listener: (event: IpcEvent, value: unknown) => unknown): void
  }
}

export function installDesktopMain({ app, ipcMain }: Desktop, rendererCode: string) {
  const repository = metricsRepository(
    path.join(app.getPath('userData'), 'codexracker', 'metrics.json'),
  )
  const clients = new Set<Contents>()
  let live = emptyLive()
  const clocks = new Map<string, { total: number; metrics: UsageMetrics }>()
  const trusted = (event: IpcEvent) =>
    event.senderFrame === event.sender.mainFrame && event.senderFrame?.url.startsWith('app:')
  const broadcast = (value: Dashboard | null) => {
    for (const client of clients) {
      if (client.isDestroyed()) clients.delete(client)
      else {
        try {
          client.send(channels.changed, value)
        } catch {
          clients.delete(client)
        }
      }
    }
  }
  ipcMain.handle(channels.liveSnapshot, (event) => {
    if (!trusted(event)) throw new Error('tracker-untrusted-frame')
    clients.add(event.sender)
    return sanitizeLive(live)
  })
  ipcMain.on(channels.live, (event, value) => {
    if (!trusted(event)) return
    const incoming = sanitizeLive(value)
    live = {
      ...((incoming.limitsUpdatedAt ?? 0) >= (live.limitsUpdatedAt ?? 0) ? incoming : live),
      run: (incoming.run.updatedAt ?? 0) >= (live.run.updatedAt ?? 0) ? incoming.run : live.run,
    }
    clients.add(event.sender)
    for (const client of clients) {
      if (client.isDestroyed()) {
        clients.delete(client)
        continue
      }
      try {
        client.send(channels.liveChanged, live)
      } catch {
        clients.delete(client)
      }
    }
  })
  ipcMain.handle(channels.snapshot, async (event) => {
    if (!trusted(event)) throw new Error('tracker-untrusted-frame')
    clients.add(event.sender)
    try {
      return await repository.snapshot()
    } catch {
      throw new Error('tracker-storage-unavailable')
    }
  })
  ipcMain.handle(channels.settings, async (event, value) => {
    if (!trusted(event)) throw new Error('tracker-untrusted-frame')
    try {
      const snapshot = await repository.saveSettings(value)
      broadcast(snapshot)
      return snapshot
    } catch {
      throw new Error('tracker-settings-not-saved')
    }
  })
  ipcMain.on(channels.record, (event, value) => {
    if (!trusted(event)) return
    const envelope = objectFrom(value)
    const identity = objectFrom(envelope.identity)
    const total = tokenNumber(identity.total)
    if (typeof identity.key !== 'string' || identity.key.length > 1000 || total === undefined)
      return
    const previous = clocks.get(identity.key)
    if ((previous && total <= previous.total) || (!previous && clocks.size >= 10000)) return
    const cumulative = sanitizeMetrics(identity.cumulative)
    if (!hasMetrics(cumulative)) return
    const difference = (field: keyof UsageMetrics) => {
      const before = previous?.metrics[field]
      const after = cumulative[field]
      return before !== undefined && after !== undefined && after >= before
        ? after - before
        : undefined
    }
    const metrics = previous
      ? sanitizeMetrics({
          inputTokens: difference('inputTokens'),
          outputTokens: difference('outputTokens'),
          promptCacheHitTokens: difference('promptCacheHitTokens'),
        })
      : sanitizeMetrics(envelope.metrics)
    if (!Object.values(metrics).some((value) => value !== undefined && value > 0)) return
    // Multiple renderer windows can receive the same notification. Count once per process.
    clocks.set(identity.key, { total, metrics: cumulative })
    clients.add(event.sender)
    void repository
      .append({
        ...metrics,
        recordedAt: new Date().toISOString(),
        model: identifier(objectFrom(identity.model).model),
        provider: identifier(objectFrom(identity.model).provider),
        serviceTier: identifier(objectFrom(identity.model).serviceTier),
      })
      .then(broadcast, () => broadcast(null))
  })
  app.on('web-contents-created', (_event, contents) => {
    contents.on('dom-ready', () => {
      // Mount in the actual page world; the isolated preload only exposes a narrow API.
      void contents
        .executeJavaScript(
          `if(location.protocol==='app:' && window.codexracker){${rendererCode}\n}`,
        )
        .catch(() => {})
    })
  })
  return repository
}
