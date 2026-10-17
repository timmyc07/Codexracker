import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { dailyMission } from '../../src/overlay/missions'
import { MetricsRepository } from '../../src/storage/metrics-db'
import { sanitizeQuotaBaseline } from '../../src/storage/schema'

const now = new Date(2026, 9, 17, 9)
const weekly = {
  remainingPercent: 100,
  resetsAt: now.getTime() / 1000 + 7 * 86400,
  windowDurationMins: 10080,
}
const baseline = { recordedAt: now.toISOString(), resetsAt: weekly.resetsAt, remainingPercent: 100 }
let directory = ''
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('daily quota missions', () => {
  it('divides a full week into seven equal daily targets', () => {
    const mission = dailyMission(weekly, baseline, now)!
    expect(mission.daysLeft).toBe(7)
    expect(mission.target).toBeCloseTo(100 / 7)
    expect(mission.remaining).toBeCloseTo(100 / 7)
    expect(mission.progress).toBe(0)
  })
  it('keeps the daily target fixed as quota is consumed and caps completion', () => {
    const mission = dailyMission({ ...weekly, remainingPercent: 90 }, baseline, now)!
    expect(mission.target).toBeCloseTo(100 / 7)
    expect(mission.used).toBe(10)
    expect(mission.remaining).toBeCloseTo(100 / 7 - 10)
    expect(mission.progress).toBeCloseTo(70)
    expect(dailyMission({ ...weekly, remainingPercent: 80 }, baseline, now)).toMatchObject({
      progress: 100,
      remaining: 0,
    })
  })
  it('handles partial days, unavailable reset times and exhausted windows honestly', () => {
    const short = { ...weekly, remainingPercent: 12, resetsAt: now.getTime() / 1000 + 3600 }
    expect(dailyMission(short, undefined, now)).toMatchObject({
      daysLeft: 1,
      target: 12,
      synced: false,
    })
    expect(dailyMission(null, baseline, now)).toBeNull()
    expect(dailyMission({ ...weekly, resetsAt: null }, baseline, now)).toBeNull()
    expect(dailyMission({ ...weekly, resetsAt: now.getTime() / 1000 }, baseline, now)).toBeNull()
    expect(
      dailyMission({ ...weekly, remainingPercent: 0 }, { ...baseline, remainingPercent: 0 }, now),
    ).toMatchObject({ progress: 100, remaining: 0 })
  })
  it('discards a prior day or cycle baseline', () => {
    const tomorrow = new Date(2026, 9, 18, 9)
    expect(dailyMission({ ...weekly, remainingPercent: 60 }, baseline, tomorrow)).toMatchObject({
      target: 10,
      synced: false,
    })
    expect(
      dailyMission({ ...weekly, resetsAt: weekly.resetsAt + 86400 }, baseline, now)?.synced,
    ).toBe(false)
  })
  it('reduces the allocation days at local midnight and keeps the target fixed all day', () => {
    const midnight = new Date(2026, 9, 18)
    const nextBaseline = { ...baseline, recordedAt: midnight.toISOString(), remainingPercent: 90 }
    const quota = { ...weekly, remainingPercent: 90 }
    expect(dailyMission(quota, nextBaseline, midnight)).toMatchObject({
      daysLeft: 6,
      target: 15,
      used: 0,
      remaining: 15,
      synced: true,
    })
    expect(
      dailyMission({ ...quota, remainingPercent: 85 }, nextBaseline, new Date(2026, 9, 18, 23, 59)),
    ).toMatchObject({ daysLeft: 6, target: 15, used: 5, remaining: 10 })
  })
  it('allocates remaining quota on the reset date until the exact reset time', () => {
    const resetDay = new Date(2026, 9, 24)
    const quota = { ...weekly, remainingPercent: 12 }
    expect(dailyMission(quota, undefined, resetDay)).toMatchObject({ daysLeft: 1, target: 12 })
    expect(dailyMission(quota, undefined, new Date(weekly.resetsAt * 1000))).toBeNull()
  })
  it('persists today across restarts, rolls over at midnight and clears on account changes', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tokentracker-mission-'))
    const file = path.join(directory, 'metrics.json')
    await new MetricsRepository(file).trackQuota(weekly, now)
    const repository = new MetricsRepository(file)
    const later = await repository.trackQuota(
      { ...weekly, remainingPercent: 80 },
      new Date(2026, 9, 17, 21),
    )
    expect(later.quotaBaseline).toEqual(baseline)
    const next = await repository.trackQuota(
      { ...weekly, remainingPercent: 80 },
      new Date(2026, 9, 18, 0),
    )
    expect(next.quotaBaseline?.remainingPercent).toBe(80)
    const reset = await repository.trackQuota(
      { ...weekly, resetsAt: weekly.resetsAt + 7 * 86400 },
      new Date(2026, 9, 18, 1),
    )
    expect(reset.quotaBaseline?.resetsAt).toBe(weekly.resetsAt + 7 * 86400)
    expect((await repository.trackQuota(null)).quotaBaseline).toBeUndefined()
    expect(await readFile(file, 'utf8')).not.toContain('quotaBaseline')
  })
  it('rejects malformed baselines and projects away unrelated data', () => {
    expect(() => sanitizeQuotaBaseline({ ...baseline, remainingPercent: NaN })).toThrow()
    expect(() => sanitizeQuotaBaseline({ ...baseline, resetsAt: 0 })).toThrow()
    expect(sanitizeQuotaBaseline({ ...baseline, prompt: 'PRIVATE' })).toEqual(baseline)
  })
})
