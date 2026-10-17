import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createController } from '../../src/companion/controller'
import { channels } from '../../src/bridge'
import type { Dashboard } from '../../src/overlay/summary'
let root = ''
afterEach(async () => {
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
