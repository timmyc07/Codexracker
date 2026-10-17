import { channels } from '../bridge'
import { metricsRepository } from '../storage/metrics-db'
import { emptyLive, sanitizeLive, identifier } from '../interceptor/live'
import { objectFrom, sanitizeMetrics, tokenNumber, hasMetrics } from '../interceptor/usage'
import type { UsageMetrics } from '../interceptor/usage'

export function createController(
  file: string,
  broadcast: (channel: string, value: unknown) => void,
) {
  const repository = metricsRepository(file)
  let live = emptyLive()
  const clocks = new Map<string, { total: number; metrics: UsageMetrics }>()
  const changed = (value: unknown) => broadcast(channels.changed, value)
  return async (channel: string, value: unknown): Promise<unknown> => {
    if (channel === channels.snapshot)
      return live.weekly ? repository.trackQuota(live.weekly) : repository.snapshot()
    if (channel === channels.settings) {
      const snapshot = await repository.saveSettings(value)
      changed(snapshot)
      return snapshot
    }
    if (channel === channels.liveSnapshot) return live
    if (channel === channels.live) {
      const incoming = sanitizeLive(value)
      const fresh = (incoming.limitsUpdatedAt ?? 0) >= (live.limitsUpdatedAt ?? 0)
      if (
        fresh &&
        incoming.limitsUpdatedAt !== null &&
        incoming.limitsUpdatedAt !== live.limitsUpdatedAt &&
        ['ready', 'unknown'].includes(incoming.limitsStatus)
      ) {
        void repository.trackQuota(incoming.weekly).then(changed, () => changed(null))
      }
      live = {
        ...(fresh ? incoming : live),
        run: (incoming.run.updatedAt ?? 0) >= (live.run.updatedAt ?? 0) ? incoming.run : live.run,
      }
      broadcast(channels.liveChanged, live)
      return
    }
    if (channel !== channels.record) throw new Error('tracker-unknown-operation')
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
      const before = previous?.metrics[field],
        after = cumulative[field]
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
    if (!Object.values(metrics).some((n) => n !== undefined && n > 0)) return
    clocks.set(identity.key, { total, metrics: cumulative })
    try {
      const model = objectFrom(identity.model)
      changed(
        await repository.append({
          ...metrics,
          recordedAt: new Date().toISOString(),
          model: identifier(model.model),
          provider: identifier(model.provider),
          serviceTier: identifier(model.serviceTier),
        }),
      )
    } catch {
      changed(null)
    }
  }
}
