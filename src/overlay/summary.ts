import type { UsageMetrics } from '../interceptor/usage'
import type { MetricRecord, QuotaBaseline, Settings } from '../storage/schema'

export interface Summary extends UsageMetrics {
  totalTokens: number | undefined
  usageUpdateCount: number
  cacheHitCount: number
  requestCount: null
}
export interface Dashboard {
  latest: MetricRecord | null
  latestSummary: Summary
  total: Summary
  today: Summary
  todayDate: string
  quotaBaseline?: QuotaBaseline
  recent: MetricRecord[]
  settings: Settings
}

export function summarize(records: MetricRecord[]): Summary {
  const sum = (field: keyof UsageMetrics): number | undefined => {
    if (!records.length) return undefined
    let total = 0
    for (const record of records) {
      const value = record[field]
      if (value === undefined) return undefined
      total += value
      if (!Number.isSafeInteger(total)) return undefined
    }
    return total
  }
  const inputTokens = sum('inputTokens')
  const outputTokens = sum('outputTokens')
  const combined =
    inputTokens === undefined || outputTokens === undefined ? undefined : inputTokens + outputTokens
  return {
    totalTokens: !records.length
      ? 0
      : combined !== undefined && Number.isSafeInteger(combined)
        ? combined
        : undefined,
    inputTokens,
    outputTokens,
    promptCacheHitTokens: sum('promptCacheHitTokens'),
    usageUpdateCount: records.length,
    cacheHitCount: records.filter((record) => (record.promptCacheHitTokens ?? 0) > 0).length,
    requestCount: null,
  }
}

export const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function dashboard(
  records: MetricRecord[],
  settings: Settings,
  quotaBaseline?: QuotaBaseline,
  now = new Date(),
): Dashboard {
  const latest = records.at(-1) ?? null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  return {
    latest,
    latestSummary: summarize(latest ? [latest] : []),
    total: summarize(records),
    today: summarize(
      records.filter((record) => {
        const at = Date.parse(record.recordedAt)
        return at >= start && at < end
      }),
    ),
    todayDate: localDay(now),
    quotaBaseline,
    recent: records.slice(-20).reverse(),
    settings,
  }
}
