import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { installDesktopMain } from '../../injector/desktop-main'
import { channels } from '../../src/bridge'

let directory = ''
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

it('rejects page/subframe writes and deduplicates overlapping notifications across renderer windows', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codexracker-main-'))
  type Event = Parameters<Parameters<typeof installDesktopMain>[0]['ipcMain']['on']>[1] extends (
    event: infer E,
    value: unknown,
  ) => void
    ? E
    : never
  const listeners = new Map<string, (event: Event, value: unknown) => void>()
  const handlers = new Map<string, (event: Event, value: unknown) => unknown>()
  const repository = installDesktopMain(
    {
      app: { getPath: () => directory, on: vi.fn() },
      ipcMain: {
        on: (channel, listener) => {
          listeners.set(channel, listener)
        },
        handle: (channel, handler) => {
          handlers.set(channel, handler)
        },
      },
    },
    '',
  )
  const frame = { url: 'app://-/index.html' }
  const sender = {
    mainFrame: frame,
    send: vi.fn(),
    isDestroyed: () => false,
    executeJavaScript: vi.fn(),
    on: vi.fn(),
  }
  const event = { sender, senderFrame: frame }
  const update = (input: number, delta: number) => ({
    metrics: { inputTokens: delta, outputTokens: 0, promptCacheHitTokens: 0, prompt: 'PRIVATE' },
    identity: {
      key: 'local/thread',
      total: input,
      cumulative: { inputTokens: input, outputTokens: 0, promptCacheHitTokens: 0 },
    },
  })
  const record = listeners.get(channels.record)!
  record({ ...event, senderFrame: { url: 'https://example.com' } }, update(200, 100))
  record({ ...event, senderFrame: { url: frame.url } }, update(200, 100))
  expect((await repository.snapshot()).total.usageUpdateCount).toBe(0)
  await expect(
    handlers.get(channels.snapshot)!(
      { ...event, senderFrame: { url: 'https://example.com' } },
      undefined,
    ),
  ).rejects.toThrow('untrusted')
  record(event, update(200, 100))
  record(event, update(200, 100))
  // Another window has an older baseline and reports an overlapping 200-token delta.
  record(event, update(300, 200))
  const contextOnly = update(300, 100)
  contextOnly.identity.total = 400
  record(event, contextOnly)
  const state = await repository.snapshot()
  expect(state.total.usageUpdateCount).toBe(2)
  expect(state.total.inputTokens).toBe(200)
  expect(JSON.stringify(state)).not.toContain('PRIVATE')
})
