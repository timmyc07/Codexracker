import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MetricsRepository, metricsRepository } from '../../src/storage/metrics-db'
import { defaultSettings, sanitizeSettings } from '../../src/storage/schema'
import { summarize } from '../../src/overlay/summary'

const metric = {
  recordedAt: '2026-10-15T00:00:00Z',
  inputTokens: 100,
  outputTokens: 20,
  promptCacheHitTokens: 80,
}
const settings = defaultSettings
let directory = ''
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
async function file() {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codexracker-hud-'))
  return path.join(directory, 'metrics.json')
}

describe('persistent dashboard lifecycle', () => {
  it('serializes concurrent usage and settings, then restores from disk in a new instance', async () => {
    const target = await file()
    const repository = metricsRepository(target)
    const configured = {
      ...settings(),
      position: { x: 120, y: 240 },
      minimized: true,
      opacity: 0.7,
    }
    await Promise.all([
      ...Array.from({ length: 50 }, () => repository.append(metric)),
      repository.saveSettings(configured),
    ])
    const restored = await new MetricsRepository(target).snapshot()
    expect(restored.total.usageUpdateCount).toBe(50)
    expect(restored.total.inputTokens).toBe(5000)
    expect(restored.settings).toEqual(configured)
    expect(restored.latest?.model).toBeUndefined()
    expect(restored.total.requestCount).toBeNull()
    expect(restored.recent).toHaveLength(20)
  })
  it('preserves token history when display settings change and drops retired fields', async () => {
    const target = await file()
    await writeFile(
      target,
      JSON.stringify({
        records: [metric],
        settings: {
          ...settings(),
          currency: 'TWD',
          rates: [{ model: 'old' }],
          pricingModel: 'old',
          autoPricing: true,
        },
      }),
    )
    const repository = new MetricsRepository(target)
    const restored = await repository.snapshot()
    expect(restored.settings).toEqual(settings())
    await repository.saveSettings({ ...settings(), opacity: 0.7 })
    expect((await repository.snapshot()).total.outputTokens).toBe(20)
    expect(await readFile(target, 'utf8')).not.toMatch(/currency|pricingModel|rates|autoPricing/)
  })
  it('projects data and settings before persistence and does not retain caller mutations', async () => {
    const target = await file()
    const repository = new MetricsRepository(target)
    const untrusted = {
      ...metric,
      prompt: 'PRIVATE_PROMPT',
      rawEvent: { response: 'PRIVATE_RESPONSE' },
    }
    const append = repository.append(untrusted)
    untrusted.inputTokens = 999
    await append
    await repository.saveSettings({ ...settings(), prompt: 'PRIVATE_SETTINGS' })
    const text = await readFile(target, 'utf8')
    expect(text).not.toContain('PRIVATE')
    expect(JSON.parse(text).records[0].inputTokens).toBe(100)
  })
  it('preserves corrupt files and surfaces a failure instead of resetting history', async () => {
    const target = await file()
    const repository = new MetricsRepository(target)
    await writeFile(target, 'broken-json')
    await expect(repository.append(metric)).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('broken-json')
    await writeFile(target, JSON.stringify({ records: [], settings: defaultSettings() }))
    expect((await repository.append(metric)).total.usageUpdateCount).toBe(1)
  })
})

describe('token totals and display settings', () => {
  it.each([0, 80, 100])('keeps cached input inside total input for %s cached tokens', (cached) => {
    const summary = summarize([{ ...metric, promptCacheHitTokens: cached }])
    expect(summary.inputTokens).toBe(100)
    expect(summary.promptCacheHitTokens).toBe(cached)
    expect(summary.cacheHitCount).toBe(cached > 0 ? 1 : 0)
  })
  it('keeps missing fields and mixed incomplete totals unknown', () => {
    const summary = summarize([metric, { recordedAt: metric.recordedAt, inputTokens: 100 }])
    expect(summary.inputTokens).toBe(200)
    expect(summary.outputTokens).toBeUndefined()
    expect(summary.promptCacheHitTokens).toBeUndefined()
    expect(summarize([]).inputTokens).toBeUndefined()
    expect(
      summarize([{ ...metric, inputTokens: Number.MAX_SAFE_INTEGER }, metric]).inputTokens,
    ).toBeUndefined()
  })
  it('rejects non-finite or out-of-range display settings', () => {
    for (const opacity of [0, -1, NaN, Infinity, 1.1])
      expect(() => sanitizeSettings({ ...settings(), opacity })).toThrow()
    expect(() => sanitizeSettings({ ...settings(), position: { x: -1, y: 0 } })).toThrow()
  })
})
