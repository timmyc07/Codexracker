import { afterEach, expect, it, vi } from 'vitest'
import { createTrackerBridge } from '../../src/companion/bridge'
import { channels } from '../../src/bridge'

afterEach(() => vi.useRealTimers())
function fixture() {
  const listeners = new Map<string, Array<(event: unknown, value: unknown) => void>>()
  const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(
    async () => undefined,
  )
  const ipc = {
    send: vi.fn(),
    invoke,
    on: (channel: string, listener: (event: unknown, value: unknown) => void) =>
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener]),
    removeListener: vi.fn(),
  }
  const api = createTrackerBridge(ipc)
  const receive = (value: unknown) => {
    for (const listener of listeners.get('codex_desktop:message-for-view') ?? [])
      listener(undefined, value)
  }
  return { ipc, api, receive, invoke }
}
it('coalesces initial/manual quota refresh and resolves both callers only after the reply', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const first = f.api.refreshLimits()
  const second = f.api.refreshLimits()
  expect(second).toBe(first)
  expect(f.invoke).toHaveBeenCalledTimes(1)
  const request = f.invoke.mock.calls[0][1] as { request: { id: string } }
  f.receive({
    type: 'mcp-response',
    hostId: 'local',
    message: {
      id: request.request.id,
      result: { rateLimits: { secondary: { usedPercent: 3, windowDurationMins: 10080 } } },
    },
  })
  await first
  const last = f.ipc.send.mock.calls.at(-1)
  expect(last?.[0]).toBe(channels.live)
  expect(last?.[1].weekly.remainingPercent).toBe(97)
})
it('marks timeout unavailable and shields malformed events from host listeners', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const refresh = f.api.refreshLimits()
  await vi.advanceTimersByTimeAsync(15000)
  await refresh
  expect(f.ipc.send.mock.calls.at(-1)?.[1].limitsStatus).toBe('unavailable')
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  expect(() =>
    f.receive({ type: 'mcp-response', hostId: 'local', message: { id: cyclic } }),
  ).not.toThrow()
})
it('preserves every host IPC argument while observing only the verified request channel', async () => {
  const f = fixture()
  const first = { value: 1 }
  const second = { value: 2 }
  await f.ipc.invoke('host-unrelated-channel', first, second)
  expect(f.invoke).toHaveBeenCalledExactlyOnceWith('host-unrelated-channel', first, second)
})
