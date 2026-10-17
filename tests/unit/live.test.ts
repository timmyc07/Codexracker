import { describe, expect, it } from 'vitest'
import { createLiveObserver, sanitizeLive } from '../../src/interceptor/live'

const note = (method: string, params: Record<string, unknown>, hostId = 'local') => ({
  type: 'mcp-notification',
  hostId,
  method,
  params,
})
const turn = { threadId: 'thread', turn: { id: 'turn', status: 'inProgress' } }
const response = (id: string, result: unknown) => ({
  type: 'mcp-response',
  hostId: 'local',
  message: { id, result },
})
describe('live stream and model identity', () => {
  it('updates before final usage, keeps Unicode counts, and never publishes text or thread identifiers', () => {
    const updates: unknown[] = []
    const observer = createLiveObserver((state) => updates.push(state))
    observer.observe(
      response('resume', {
        model: 'gpt-6.1-sol',
        modelProvider: 'openai',
        thread: { id: 'thread', turns: ['PRIVATE_HISTORY'] },
      }),
    )
    observer.observe(note('turn/started', turn))
    observer.observe(
      note('item/agentMessage/delta', { threadId: 'thread', turnId: 'turn', delta: '字😀' }),
    )
    expect(observer.snapshot().run).toMatchObject({
      status: 'streaming',
      outputCharacters: 2,
      outputChunks: 1,
      model: 'gpt-6.1-sol',
    })
    expect(observer.snapshot().run.measured.outputTokens).toBeUndefined()
    observer.observe(
      note('item/reasoning/textDelta', {
        threadId: 'thread',
        turnId: 'turn',
        delta: 'PRIVATE_REASONING',
      }),
    )
    observer.observe(
      note('thread/tokenUsage/updated', {
        threadId: 'thread',
        turnId: 'turn',
        tokenUsage: { last: { inputTokens: 100, outputTokens: 3, cachedInputTokens: 80 } },
      }),
    )
    observer.observe(
      note('turn/completed', {
        ...turn,
        turn: { id: 'turn', status: 'completed', error: 'PRIVATE_ERROR' },
      }),
    )
    observer.observe(
      note('item/agentMessage/delta', { threadId: 'thread', turnId: 'turn', delta: 'late' }),
    )
    expect(observer.snapshot().run).toMatchObject({
      status: 'completed',
      outputCharacters: 2,
      measured: { outputTokens: 3 },
    })
    expect(JSON.stringify(updates)).not.toMatch(/PRIVATE|threadId|😀/)
  })
  it('uses accepted turn overrides, isolates threads, and ignores stale completion or duplicate starts', () => {
    const observer = createLiveObserver(() => {})
    observer.observe(
      response('resume', { model: 'model-a', modelProvider: 'openai', thread: { id: 'thread' } }),
    )
    observer.observeRequest({
      type: 'mcp-request',
      hostId: 'local',
      request: {
        id: 'start',
        method: 'turn/start',
        params: { threadId: 'thread', model: 'model-b', input: 'PRIVATE_INPUT' },
      },
    })
    observer.observe(note('turn/started', turn))
    observer.observe(response('start', { turn: { id: 'turn' } }))
    expect(observer.modelFor('local', 'thread', 'turn')).toMatchObject({
      model: 'model-b',
      provider: 'openai',
    })
    observer.observe(
      note('item/agentMessage/delta', { threadId: 'thread', turnId: 'turn', delta: 'abc' }),
    )
    observer.observe(note('turn/started', turn))
    expect(observer.snapshot().run.outputCharacters).toBe(3)
    observer.observe(
      note('item/agentMessage/delta', {
        threadId: 'other-thread',
        turnId: 'turn',
        delta: 'PRIVATE',
      }),
    )
    expect(observer.snapshot().run.outputCharacters).toBe(3)
    observer.observe(note('turn/started', { ...turn, turn: { id: 'new-turn' } }))
    observer.observe(note('turn/completed', { ...turn, turn: { id: 'turn', status: 'completed' } }))
    expect(observer.snapshot().run.status).toBe('working')
  })
})
describe('official quota windows', () => {
  it('selects a seven-day window by duration, rather than subtracting local tokens', () => {
    const observer = createLiveObserver(
      () => {},
      () => 1234,
    )
    observer.receiveLimits({
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 10, windowDurationMins: 300 },
        secondary: { usedPercent: 3, windowDurationMins: 10080, resetsAt: 2000 },
      },
    })
    expect(observer.snapshot()).toMatchObject({
      weekly: { remainingPercent: 97, resetsAt: 2000 },
      primary: { remainingPercent: 90 },
      limitsUpdatedAt: 1234,
    })
    observer.limitsUnavailable()
    expect(observer.snapshot()).toMatchObject({
      weekly: { remainingPercent: 97 },
      limitsStatus: 'unavailable',
    })
    observer.observe(note('account/updated', {}))
    expect(observer.snapshot().weekly).toBeNull()
  })
  it('keeps missing weekly data unknown and selects the exact codex bucket', () => {
    const observer = createLiveObserver(() => {})
    observer.receiveLimits({
      rateLimits: { secondary: { usedPercent: 3, windowDurationMins: 60 } },
    })
    expect(observer.snapshot().weekly).toBeNull()
    observer.receiveLimits({
      rateLimits: { secondary: { usedPercent: 3, windowDurationMins: 10080 } },
      rateLimitsByLimitId: { codex: { secondary: { usedPercent: 5, windowDurationMins: 10080 } } },
    })
    expect(observer.snapshot().weekly?.remainingPercent).toBe(95)
    observer.observe(
      note(
        'account/rateLimits/updated',
        { rateLimits: { secondary: { usedPercent: 99, windowDurationMins: 10080 } } },
        'remote',
      ),
    )
    expect(observer.snapshot().weekly?.remainingPercent).toBe(95)
  })
  it('projects live data independently at Main ingress', () => {
    const state = sanitizeLive({
      prompt: 'PRIVATE',
      run: { status: 'streaming', outputCharacters: 3, model: 'model', response: 'PRIVATE' },
      weekly: { remainingPercent: 97, windowDurationMins: 10080 },
      rawEvent: 'PRIVATE',
    })
    expect(state.weekly?.remainingPercent).toBe(97)
    expect(JSON.stringify(state)).not.toContain('PRIVATE')
    expect(state.run.measured.outputTokens).toBeUndefined()
  })
})
