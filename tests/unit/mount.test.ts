import { afterEach, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { mountOverlay } from '../../src/overlay/mount'
import { dashboardStore, nowStore, storageError } from '../../src/overlay/store'
import { dashboard } from '../../src/overlay/summary'
import { defaultSettings } from '../../src/storage/schema'
import { emptyLive } from '../../src/interceptor/live'

vi.mock('svelte', () => ({ mount: vi.fn() }))
vi.mock('../../src/overlay/components/Hud.svelte', () => ({ default: {} }))

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  vi.useRealTimers()
  vi.unstubAllGlobals()
  storageError.set('')
})

it('refreshes at midnight, retries failed reads, catches up after sleep and cleans up listeners', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 17, 23, 59, 59, 250))
  const snapshot = vi.fn(async () => dashboard([], defaultSettings()))
  const unsubscribe = vi.fn()
  const unsubscribeLive = vi.fn()
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      codexracker: {
        snapshot,
        liveSnapshot: async () => emptyLive(),
        subscribe: () => unsubscribe,
        subscribeLive: () => unsubscribeLive,
      },
    }),
  )
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      createElement: () => ({ attachShadow: () => ({}), style: {} }),
    }),
  )
  const target = { querySelector: () => null, appendChild: vi.fn() } as unknown as HTMLElement
  await mountOverlay(target)
  expect(snapshot).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(749)
  expect(snapshot).toHaveBeenCalledTimes(1)
  dashboardStore.update((snapshot) => ({ ...snapshot, todayDate: '2026-10-18' }))
  await vi.advanceTimersByTimeAsync(1)
  expect(snapshot).toHaveBeenCalledTimes(2)
  expect(get(dashboardStore).todayDate).toBe('2026-10-18')
  expect(get(nowStore)).toBe(new Date(2026, 9, 18).getTime())

  vi.setSystemTime(new Date(2026, 9, 20, 12))
  snapshot.mockRejectedValueOnce(new Error('read-failed'))
  window.dispatchEvent(new Event('focus'))
  await Promise.resolve()
  expect(get(storageError)).toContain('本機紀錄讀取失敗')
  await vi.advanceTimersByTimeAsync(60000)
  expect(get(dashboardStore).todayDate).toBe('2026-10-20')
  expect(get(storageError)).toBe('')

  vi.setSystemTime(new Date(2026, 9, 21, 8))
  document.dispatchEvent(new Event('visibilitychange'))
  await Promise.resolve()
  expect(get(dashboardStore).todayDate).toBe('2026-10-21')
  expect(vi.getTimerCount()).toBe(1)
  window.dispatchEvent(new Event('pagehide'))
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(unsubscribeLive).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  window.dispatchEvent(new Event('focus'))
  document.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0)
})
