import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createUsageSseParser,
  consumeUsageSse,
  parseSseEvent,
} from '../../src/interceptor/sse-parser'
import {
  createAppServerUsageObserver,
  installIpcUsageInterceptor,
  usageChannel,
} from '../../src/interceptor/proxy'
import { appendMetric } from '../../src/storage/metrics-db'
import { normalizeAppServerUsage } from '../../src/interceptor/usage'

const completed = (cached: unknown = 80) =>
  JSON.stringify({
    type: 'response.completed',
    response: {
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: cached },
      },
      output: 'PRIVATE_RESPONSE',
    },
    prompt: 'PRIVATE_PROMPT',
  })
const notification = (
  input = 100,
  output = 20,
  cached: unknown = 80,
  hostId = 'local',
  threadId = 'thread',
) => ({
  type: 'mcp-notification',
  hostId,
  method: 'thread/tokenUsage/updated',
  params: {
    threadId,
    turnId: 'turn',
    tokenUsage: {
      total: {
        inputTokens: input,
        outputTokens: output,
        cachedInputTokens: cached,
        totalTokens: input + output,
      },
      last: { inputTokens: 9999 },
    },
    prompt: 'PRIVATE_PROMPT',
  },
})

describe('incremental SSE usage', () => {
  it.each([0, 80, 100])('preserves zero, partial and full cache: %s', (cached) => {
    expect(parseSseEvent(completed(cached))).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      promptCacheHitTokens: cached,
    })
  })
  it('supports all split points including CRLF and multiline data', () => {
    const stream = `: comment\r\nevent: response.completed\r\ndata: {"type":"response.completed",\r\ndata: "response":{"usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":80}}}}\r\n\r\ndata: [DONE]\r\n\r\n`
    for (let cut = 0; cut <= stream.length; cut++) {
      const callback = vi.fn()
      const parser = createUsageSseParser(callback)
      parser.feed(stream.slice(0, cut))
      parser.feed(stream.slice(cut))
      parser.end()
      expect(callback).toHaveBeenCalledExactlyOnceWith({
        inputTokens: 100,
        outputTokens: 20,
        promptCacheHitTokens: 80,
      })
    }
  })
  it('supports one character chunks and bare CR line endings', () => {
    const callback = vi.fn()
    const parser = createUsageSseParser(callback)
    for (const character of `\uFEFFdata: ${completed()}\r\r`) parser.feed(character)
    parser.end()
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('discards incomplete EOF events and rejects feed after end', () => {
    const callback = vi.fn()
    const parser = createUsageSseParser(callback)
    parser.feed(`data: ${completed()}\n`)
    parser.end()
    parser.feed('\n')
    expect(callback).not.toHaveBeenCalled()
  })
  it('ignores malformed and non-model events and stops at DONE', () => {
    const callback = vi.fn()
    const parser = createUsageSseParser(callback)
    parser.feed(
      `data: broken\n\ndata: {"usage":{"prompt_tokens":100}}\n\ndata: [DONE]\n\ndata: ${completed()}\n\n`,
    )
    expect(callback).not.toHaveBeenCalled()
  })
  it('counts one terminal usage per stream', () => {
    const callback = vi.fn()
    const parser = createUsageSseParser(callback)
    parser.feed(`data: ${completed()}\n\ndata: ${completed()}\n\n`)
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('supports Chat Completions final usage-only chunks', () => {
    expect(
      parseSseEvent(
        JSON.stringify({
          object: 'chat.completion.chunk',
          choices: [],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        }),
      ),
    ).toEqual({ inputTokens: 100, outputTokens: 20, promptCacheHitTokens: 0 })
  })
  it('keeps missing/invalid fields unknown', () => {
    expect(
      parseSseEvent('{"type":"response.completed","response":{"usage":{"input_tokens":0}}}'),
    ).toEqual({ inputTokens: 0, outputTokens: undefined, promptCacheHitTokens: undefined })
    expect(
      parseSseEvent(
        '{"type":"response.completed","response":{"usage":{"input_tokens":-1,"output_tokens":1.5}}}',
      ),
    ).toBeUndefined()
    expect(parseSseEvent(completed(101))?.promptCacheHitTokens).toBeUndefined()
    expect(parseSseEvent('null')).toBeUndefined()
    expect(parseSseEvent('bad')).toBeUndefined()
    expect(parseSseEvent(completed('80'))?.promptCacheHitTokens).toBeUndefined()
  })
  it('bounds memory on oversized unfinished events', () => {
    const callback = vi.fn()
    const parser = createUsageSseParser(callback)
    parser.feed('data: ' + 'x'.repeat(1024 * 1024 + 10))
    parser.feed(`\n\ndata: ${completed()}\n\n`)
    parser.end()
    expect(callback).not.toHaveBeenCalled()
  })
  it('decodes split UTF-8 bytes without buffering the whole stream', async () => {
    const callback = vi.fn()
    const bytes = new TextEncoder().encode(`: 中文\n\ndata: ${completed()}\n\n`)
    await consumeUsageSse(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
          controller.close()
        },
      }),
      callback,
    )
    expect(callback).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(callback.mock.calls)).not.toContain('PRIVATE')
  })
  it('releases the stream lock after read failure', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('read failed'))
      },
    })
    await expect(consumeUsageSse(stream, vi.fn())).rejects.toThrow('read failed')
    expect(stream.locked).toBe(false)
  })
})

describe('desktop IPC usage', () => {
  it('does not count context-size-only changes as model usage', () => {
    const callback = vi.fn()
    const consume = createAppServerUsageObserver(callback)
    consume(notification())
    const estimate = notification()
    estimate.params.tokenUsage.total.totalTokens = 1000
    consume(estimate)
    expect(callback).not.toHaveBeenCalled()
  })
  it('normalizes the actual bundled app-server response captured in acceptance', async () => {
    const usage = JSON.parse(
      await readFile(new URL('../fixtures/app-server-usage.json', import.meta.url), 'utf8'),
    )
    expect(normalizeAppServerUsage(usage)).toEqual({
      inputTokens: 65358,
      outputTokens: 114,
      promptCacheHitTokens: 63616,
    })
  })
  it('keeps missing input, output and cache fields unknown', () => {
    expect(normalizeAppServerUsage({ outputTokens: 0 })).toEqual({
      inputTokens: undefined,
      outputTokens: 0,
      promptCacheHitTokens: undefined,
    })
    expect(normalizeAppServerUsage({ cachedInputTokens: 0 })).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      promptCacheHitTokens: 0,
    })
    expect(
      normalizeAppServerUsage({
        inputTokens: Infinity,
        outputTokens: Number.MAX_SAFE_INTEGER + 1,
        cachedInputTokens: -1,
      }),
    ).toEqual({ inputTokens: undefined, outputTokens: undefined, promptCacheHitTokens: undefined })
  })
  it('rejects notifications without a usable cumulative clock', () => {
    const callback = vi.fn()
    const consume = createAppServerUsageObserver(callback)
    consume(notification())
    const invalid = notification(200, 40, 160)
    invalid.params.tokenUsage.total.totalTokens = -1
    consume(invalid)
    expect(callback).not.toHaveBeenCalled()
    consume(notification(200, 40, 160))
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('seeds history, ignores repeats and derives new measured usage from totals', () => {
    const callback = vi.fn()
    const consume = createAppServerUsageObserver(callback)
    consume(notification())
    consume(notification())
    consume(notification(200, 40, 160))
    consume(notification(200, 40, 160))
    consume(notification(100, 20, 80))
    expect(callback).toHaveBeenCalledExactlyOnceWith(
      {
        inputTokens: 100,
        outputTokens: 20,
        promptCacheHitTokens: 80,
      },
      {
        key: JSON.stringify(['local', 'thread']),
        total: 240,
        cumulative: { inputTokens: 200, outputTokens: 40, promptCacheHitTokens: 160 },
      },
    )
    expect(JSON.stringify(callback.mock.calls)).not.toContain('PRIVATE')
  })
  it('isolates hosts and threads and rejects unrelated envelopes', () => {
    const callback = vi.fn()
    const consume = createAppServerUsageObserver(callback)
    consume(notification())
    consume(notification(200, 40, 160, 'other-host'))
    consume(notification(200, 40, 160, 'local', 'other-thread'))
    consume({ ...notification(200, 40, 160), type: 'mcp-response' })
    consume({ ...notification(200, 40, 160), method: 'item/agentMessage/delta' })
    consume(null)
    expect(callback).not.toHaveBeenCalled()
  })
  it('does not infer missing cache fields and does not reuse stale state values', () => {
    const callback = vi.fn()
    const consume = createAppServerUsageObserver(callback)
    consume(notification())
    consume(notification(200, 40, 160))
    consume(notification(300, 60, undefined))
    // Remove a cache field explicitly (the fixture supplies a default).
    const missing = notification(400, 80)
    delete (missing.params.tokenUsage.total as { cachedInputTokens?: unknown }).cachedInputTokens
    consume(missing)
    expect(callback.mock.lastCall?.[0].promptCacheHitTokens).toBeUndefined()
  })
  it('installs once, removes its listener and isolates observer exceptions', () => {
    let listener: (event: unknown, value: unknown) => void = () => {}
    const source = {
      on: vi.fn((_channel, callback) => {
        listener = callback
      }),
      removeListener: vi.fn(),
    }
    const callback = vi.fn(() => {
      throw new Error('observer failure')
    })
    const uninstall = installIpcUsageInterceptor(source, callback)
    expect(installIpcUsageInterceptor(source, callback)).toBe(uninstall)
    listener({}, notification())
    expect(() => listener({}, notification(200, 40, 160))).not.toThrow()
    expect(source.on).toHaveBeenCalledTimes(1)
    expect(source.on.mock.calls[0][0]).toBe(usageChannel)
    uninstall()
    expect(source.removeListener).toHaveBeenCalledExactlyOnceWith(usageChannel, listener)
  })
})

describe('privacy boundary', () => {
  let directory: string
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  it('projects runtime objects before state and persistence, including excess properties', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'codexracker-usage-'))
    const file = path.join(directory, 'metrics.json')
    const untrusted = {
      inputTokens: 100,
      outputTokens: 20,
      promptCacheHitTokens: 0,
      recordedAt: '2026-10-15T00:00:00Z',
      prompt: 'PRIVATE_PROMPT',
      completion: 'PRIVATE_RESPONSE',
      rawEvent: { text: 'PRIVATE_EVENT' },
    }
    await appendMetric(file, untrusted)
    const stored = await readFile(file, 'utf8')
    expect(stored).not.toContain('PRIVATE')
    expect(JSON.parse(stored).records).toEqual([
      {
        inputTokens: 100,
        outputTokens: 20,
        promptCacheHitTokens: 0,
        recordedAt: '2026-10-15T00:00:00.000Z',
      },
    ])
  })
})
