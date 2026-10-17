import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createController } from '../../src/companion/controller'
import { channels } from '../../src/bridge'
import type { Dashboard } from '../../src/overlay/summary'
import { dailyMission } from '../../src/overlay/missions'
import { emptyLive } from '../../src/interceptor/live'
let root = ''
afterEach(async () => {
  vi.useRealTimers()
  if (root) await rm(root, { recursive: true, force: true })
})
it('deduplicates overlapping windows and persists numeric usage only', async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tokentracker-controller-'))
  const file = path.join(root, 'metrics.json'),
    handle = createController(file, () => {})
  const update = (input: number, delta: number) => ({
    metrics: { inputTokens: delta, outputTokens: 0, promptCacheHitTokens: 0, prompt: 'PRIVATE' },
    identity: {
      key: 'local/thread',
      total: input,
      cumulative: { inputTokens: input, outputTokens: 0, promptCacheHitTokens: 0 },
    },
  })
  await handle(channels.record, update(200, 100))
  await handle(channels.record, update(200, 100))
  await handle(channels.record, update(300, 200))
  const state = (await handle(channels.snapshot, undefined)) as Dashboard
  expect(state.total.totalTokens).toBe(200)
  expect(state.total.usageUpdateCount).toBe(2)
  expect(await readFile(file, 'utf8')).not.toContain('PRIVATE')
  await expect(handle('exec', 'anything')).rejects.toThrow('unknown-operation')
})

it('persists a new daily baseline while idle and redistributes unfinished quota after missed days', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const start = new Date(2026, 9, 17, 9)
  vi.setSystemTime(start)
  root = await mkdtemp(path.join(os.tmpdir(), 'tokentracker-controller-'))
  const file = path.join(root, 'metrics.json')
  const handle = createController(file, () => {})
  const weekly = {
    remainingPercent: 100,
    resetsAt: start.getTime() / 1000 + 7 * 86400,
    windowDurationMins: 10080,
  }
  const update = (remainingPercent: number) =>
    handle(channels.live, {
      ...emptyLive(),
      weekly: { ...weekly, remainingPercent },
      limitsUpdatedAt: Date.now(),
      limitsStatus: 'ready',
    })
  const snapshot = () => handle(channels.snapshot, undefined) as Promise<Dashboard>
  await update(100)
  await snapshot()
  vi.setSystemTime(new Date(2026, 9, 17, 23, 59))
  await update(95)
  const yesterday = await snapshot()
  expect(dailyMission({ ...weekly, remainingPercent: 95 }, yesterday.quotaBaseline)?.used).toBe(5)

  vi.setSystemTime(new Date(2026, 9, 18))
  const today = await snapshot()
  expect(dailyMission({ ...weekly, remainingPercent: 95 }, today.quotaBaseline)).toMatchObject({
    daysLeft: 6,
    target: 95 / 6,
    used: 0,
    synced: true,
  })
  const restarted = createController(file, () => {})
  expect(((await restarted(channels.snapshot, undefined)) as Dashboard).quotaBaseline).toEqual(
    today.quotaBaseline,
  )

  vi.setSystemTime(new Date(2026, 9, 20))
  const afterIdle = await snapshot()
  expect(dailyMission({ ...weekly, remainingPercent: 95 }, afterIdle.quotaBaseline)).toMatchObject({
    daysLeft: 4,
    target: 95 / 4,
    used: 0,
    synced: true,
  })
  vi.setSystemTime(new Date(2026, 9, 20, 13))
  await update(90)
  const later = await snapshot()
  expect(later.quotaBaseline).toEqual(afterIdle.quotaBaseline)
  expect(dailyMission({ ...weekly, remainingPercent: 90 }, later.quotaBaseline)).toMatchObject({
    target: 95 / 4,
    used: 5,
  })
})
