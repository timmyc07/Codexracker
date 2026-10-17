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
  const daysLeft = Math.min(7, Math.ceil((weekly.resetsAt * 1000 - now.getTime()) / day))
  const current =
    baseline &&
    baseline.resetsAt === weekly.resetsAt &&
    localDay(new Date(baseline.recordedAt)) === localDay(now)
      ? baseline
      : undefined
  const starting = current?.remainingPercent ?? weekly.remainingPercent
  const daysAtStart = current
    ? Math.min(7, Math.ceil((weekly.resetsAt * 1000 - Date.parse(current.recordedAt)) / day))
    : daysLeft
  const target = starting / daysAtStart
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
