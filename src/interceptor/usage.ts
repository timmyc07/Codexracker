export interface UsageMetrics {
  inputTokens?: number
  outputTokens?: number
  promptCacheHitTokens?: number
}

export const objectFrom = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export const tokenNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

/** Explicit projection is also the privacy boundary for observers and persistence. */
export function sanitizeMetrics(value: unknown): UsageMetrics {
  const record = objectFrom(value)
  const inputTokens = tokenNumber(record.inputTokens)
  const cached = tokenNumber(record.promptCacheHitTokens)
  return {
    inputTokens,
    outputTokens: tokenNumber(record.outputTokens),
    promptCacheHitTokens:
      cached !== undefined && inputTokens !== undefined && cached > inputTokens
        ? undefined
        : cached,
  }
}

export function hasMetrics(metrics: UsageMetrics): boolean {
  return Object.values(metrics).some((value) => value !== undefined)
}

export function normalizeAppServerUsage(value: unknown): UsageMetrics {
  const usage = objectFrom(value)
  return sanitizeMetrics({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    promptCacheHitTokens: usage.cachedInputTokens,
  })
}
