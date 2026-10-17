import type { LimitWindow } from '../interceptor/live'
import type { QuotaBaseline } from '../storage/schema'
import { localDay } from './summary'

const day = 86400000

export function dailyMission(
  weekly: LimitWindow | null,
  baseline: QuotaBaseline | undefined,
  now = new Date(),
) {
  if (!weekly?.resetsAt || weekly.resetsAt * 1000 <= now.getTime()) return null
  const reset = new Date(weekly.resetsAt * 1000)
  // Count local dates so the daily allocation changes at midnight, not at the reset hour.
  const daysLeft = Math.min(
    7,
    Math.max(
      1,
      (Date.UTC(reset.getFullYear(), reset.getMonth(), reset.getDate()) -
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
        day,
    ),
  )
  const current =
    baseline &&
    baseline.resetsAt === weekly.resetsAt &&
    localDay(new Date(baseline.recordedAt)) === localDay(now)
      ? baseline
      : undefined
  const starting = current?.remainingPercent ?? weekly.remainingPercent
  const target = starting / daysLeft
  const used = Math.max(0, starting - weekly.remainingPercent)
  return {
    daysLeft,
    target,
    used,
    remaining: Math.max(0, target - used),
    progress: target === 0 ? 100 : Math.min(100, (used / target) * 100),
    synced: !!current,
  }
}
