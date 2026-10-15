export interface UsageMetrics {
  inputTokens?: number
  outputTokens?: number
  promptCacheHitTokens?: number
  promptCacheReadTokens?: number
  durationMs?: number
}

const numberFrom = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const readMetrics = (value: unknown): UsageMetrics => {
  if (!value || typeof value !== 'object') return {}

  const record = value as Record<string, unknown>
  const response = record.response as Record<string, unknown> | undefined
  const usage = (record.usage ?? response?.usage) as Record<string, unknown> | undefined
  const promptTokensDetails = usage?.prompt_tokens_details as Record<string, unknown> | undefined

  return {
    inputTokens: numberFrom(usage?.prompt_tokens),
    outputTokens: numberFrom(usage?.completion_tokens),
    promptCacheHitTokens: numberFrom(
      usage?.prompt_cache_hit_tokens ?? promptTokensDetails?.cached_tokens,
    ),
    promptCacheReadTokens: numberFrom(usage?.prompt_cache_read_tokens),
    durationMs: numberFrom(record.duration_ms),
  }
}

export function parseSseEvent(data: string): UsageMetrics {
  try {
    return readMetrics(JSON.parse(data))
  } catch {
    return {}
  }
}

export function parseSseStream(chunk: string): UsageMetrics[] {
  return chunk
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n'),
    )
    .filter(Boolean)
    .map(parseSseEvent)
}
