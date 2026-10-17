import { hasMetrics, objectFrom, sanitizeMetrics } from '../interceptor/usage'
import type { UsageMetrics } from '../interceptor/usage'
import { identifier } from '../interceptor/live'

export interface MetricRecord extends UsageMetrics {
  recordedAt: string
  model?: string
  provider?: string
  serviceTier?: string
}
export interface Settings {
  position: { x: number; y: number }
  minimized: boolean
  opacity: number
}
export interface MetricsData {
  records: MetricRecord[]
  settings: Settings
  quotaBaseline?: QuotaBaseline
}
export interface QuotaBaseline {
  recordedAt: string
  resetsAt: number
  remainingPercent: number
}

export function sanitizeQuotaBaseline(value: unknown): QuotaBaseline | undefined {
  if (value === undefined) return
  const baseline = objectFrom(value)
  if (
    typeof baseline.recordedAt !== 'string' ||
    !Number.isFinite(Date.parse(baseline.recordedAt)) ||
    typeof baseline.resetsAt !== 'number' ||
    !Number.isSafeInteger(baseline.resetsAt) ||
    baseline.resetsAt * 1000 <= Date.parse(baseline.recordedAt) ||
    typeof baseline.remainingPercent !== 'number' ||
    !Number.isFinite(baseline.remainingPercent) ||
    baseline.remainingPercent < 0 ||
    baseline.remainingPercent > 100
  )
    throw new Error('invalid-quota-baseline')
  return {
    recordedAt: new Date(baseline.recordedAt).toISOString(),
    resetsAt: baseline.resetsAt,
    remainingPercent: baseline.remainingPercent,
  }
}
export const defaultSettings = (): Settings => ({
  position: { x: 16, y: 16 },
  minimized: false,
  opacity: 1,
})

function modelName(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(value)
    ? value
    : undefined
}

export function sanitizeRecord(value: unknown): MetricRecord | undefined {
  const record = objectFrom(value)
  const metrics = sanitizeMetrics(value)
  if (!hasMetrics(metrics) || typeof record.recordedAt !== 'string') return
  const timestamp = Date.parse(record.recordedAt)
  if (!Number.isFinite(timestamp)) return
  const model = modelName(record.model)
  const provider = identifier(record.provider)
  const serviceTier = identifier(record.serviceTier)
  return {
    recordedAt: new Date(timestamp).toISOString(),
    ...metrics,
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(serviceTier ? { serviceTier } : {}),
  }
}

/** Reject malformed settings; project every accepted property explicitly. */
export function sanitizeSettings(value: unknown): Settings {
  const settings = objectFrom(value)
  const position = objectFrom(settings.position)
  const coordinate = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100000
  if (
    !coordinate(position.x) ||
    !coordinate(position.y) ||
    typeof settings.minimized !== 'boolean' ||
    typeof settings.opacity !== 'number' ||
    !Number.isFinite(settings.opacity) ||
    settings.opacity < 0.3 ||
    settings.opacity > 1
  )
    throw new Error('invalid-settings')
  return {
    position: { x: position.x, y: position.y },
    minimized: settings.minimized,
    opacity: settings.opacity,
  }
}
