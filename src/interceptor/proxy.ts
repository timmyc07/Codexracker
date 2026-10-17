import {
  hasMetrics,
  normalizeAppServerUsage,
  objectFrom,
  sanitizeMetrics,
  tokenNumber,
} from './usage'
import type { UsageMetrics } from './usage'
import type { ModelIdentity } from './live'

export const usageChannel = 'codex_desktop:message-for-view'
export type MetricsObserver = (metrics: UsageMetrics) => void
export interface UsageIdentity {
  key: string
  total: number
  cumulative: UsageMetrics
  model?: ModelIdentity
}
export type AppServerMetricsObserver = (metrics: UsageMetrics, identity: UsageIdentity) => void
export interface IpcUsageSource {
  on(channel: string, listener: (event: unknown, message: unknown) => void): unknown
  removeListener(channel: string, listener: (event: unknown, message: unknown) => void): unknown
}

interface Snapshot {
  metrics: UsageMetrics
  total: number
}

/** Observe only the verified desktop IPC envelope. Never forward the envelope. */
export function createAppServerUsageObserver(
  observer: AppServerMetricsObserver,
  modelFor?: (host: string, thread: string, turn: string) => ModelIdentity,
) {
  const snapshots = new Map<string, Snapshot>()
  return (value: unknown): void => {
    const envelope = objectFrom(value)
    if (envelope.type !== 'mcp-notification' || typeof envelope.hostId !== 'string') return
    const params = objectFrom(envelope.params)
    if (
      envelope.method !== 'thread/tokenUsage/updated' ||
      typeof params.threadId !== 'string' ||
      typeof params.turnId !== 'string'
    )
      return
    const usage = objectFrom(params.tokenUsage)
    const cumulative = objectFrom(usage.total)
    const total = tokenNumber(cumulative.totalTokens)
    if (total === undefined) return
    const metrics = normalizeAppServerUsage(cumulative)
    const key = JSON.stringify([envelope.hostId, params.threadId])
    const previous = snapshots.get(key)
    // Never count replayed history, identical notifications or stale out-of-order totals.
    if (previous && total <= previous.total) return
    if (!previous && snapshots.size >= 10000) return
    if (!hasMetrics(metrics)) return
    snapshots.set(key, { metrics, total })
    if (!previous) return
    const difference = (field: keyof UsageMetrics): number | undefined => {
      const before = previous.metrics[field]
      const after = metrics[field]
      return before !== undefined && after !== undefined && after >= before
        ? after - before
        : undefined
    }
    const delta = sanitizeMetrics({
      inputTokens: difference('inputTokens'),
      outputTokens: difference('outputTokens'),
      promptCacheHitTokens: difference('promptCacheHitTokens'),
    })
    // Context-size estimates may advance totalTokens without measured token usage.
    if (Object.values(delta).some((value) => value !== undefined && value > 0)) {
      observer(delta, {
        key,
        total,
        cumulative: metrics,
        ...(modelFor ? { model: modelFor(envelope.hostId, params.threadId, params.turnId) } : {}),
      })
    }
  }
}

const installed = new WeakMap<IpcUsageSource, () => void>()

export function installIpcUsageInterceptor(
  source: IpcUsageSource,
  observer: AppServerMetricsObserver,
  modelFor?: (host: string, thread: string, turn: string) => ModelIdentity,
): () => void {
  const existing = installed.get(source)
  if (existing) return existing
  const consume = createAppServerUsageObserver(observer, modelFor)
  const listener = (_event: unknown, message: unknown) => {
    // Observer errors must not escape into the host's IPC dispatch.
    try {
      consume(message)
    } catch {
      /* No raw exception or message logging. */
    }
  }
  source.on(usageChannel, listener)
  const uninstall = () => {
    source.removeListener(usageChannel, listener)
    installed.delete(source)
  }
  installed.set(source, uninstall)
  return uninstall
}
