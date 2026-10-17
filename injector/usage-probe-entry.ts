import { installPreloadHook } from './preload-hook'
import { usageChannel } from '../src/interceptor/proxy'
import type { IpcUsageSource } from '../src/interceptor/proxy'
import { normalizeAppServerUsage, objectFrom } from '../src/interceptor/usage'
import type { UsageMetrics } from '../src/interceptor/usage'

export function installUsageProbe(
  ipcRenderer: IpcUsageSource,
  contextBridge: { exposeInMainWorld(name: string, api: unknown): void },
) {
  let state: UsageMetrics & { usageUpdateCount: number; cacheHitCount: number } = {
    usageUpdateCount: 0,
    cacheHitCount: 0,
  }
  installPreloadHook(ipcRenderer, (metrics) => {
    state = {
      ...metrics,
      usageUpdateCount: state.usageUpdateCount + 1,
      cacheHitCount: state.cacheHitCount + (metrics.promptCacheHitTokens ? 1 : 0),
    }
  })
  let latestUsage: UsageMetrics | undefined
  let notificationCount = 0
  ipcRenderer.on(usageChannel, (_event, value) => {
    const envelope = objectFrom(value)
    if (envelope.type !== 'mcp-notification' || envelope.method !== 'thread/tokenUsage/updated')
      return
    const total = objectFrom(objectFrom(objectFrom(envelope.params).tokenUsage).total)
    latestUsage = normalizeAppServerUsage(total)
    notificationCount += 1
  })
  contextBridge.exposeInMainWorld('codexrackerUsageProbe', {
    snapshot: () => ({ latestUsage, notificationCount, state }),
  })
}
