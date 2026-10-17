import type { UsageMetrics } from '../interceptor/usage'
import type { MetricRecord, Settings } from '../storage/schema'

export interface Summary extends UsageMetrics {
  usageUpdateCount: number
  cacheHitCount: number
  requestCount: null
}
export interface Dashboard {
  latest: MetricRecord | null
  latestSummary: Summary
  total: Summary
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
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    promptCacheHitTokens: sum('promptCacheHitTokens'),
    usageUpdateCount: records.length,
    cacheHitCount: records.filter((record) => (record.promptCacheHitTokens ?? 0) > 0).length,
    requestCount: null,
  }
}

export function dashboard(records: MetricRecord[], settings: Settings): Dashboard {
  const latest = records.at(-1) ?? null
  return {
    latest,
    latestSummary: summarize(latest ? [latest] : []),
    total: summarize(records),
    recent: records.slice(-20).reverse(),
    settings,
  }
}
