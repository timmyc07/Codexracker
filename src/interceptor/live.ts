import { normalizeAppServerUsage, objectFrom, tokenNumber } from './usage'
import type { UsageMetrics } from './usage'

export interface ModelIdentity {
  model?: string
  provider?: string
  serviceTier?: string
}
export interface LiveRun extends ModelIdentity {
  status: 'idle' | 'working' | 'streaming' | 'completed' | 'interrupted' | 'failed'
  outputCharacters: number
  reasoningCharacters: number
  outputChunks: number
  measured: UsageMetrics
  updatedAt: number | null
}
export interface LimitWindow {
  remainingPercent: number
  windowDurationMins: number
  resetsAt: number | null
}
export interface LiveSnapshot {
  run: LiveRun
  weekly: LimitWindow | null
  primary: LimitWindow | null
  limitsUpdatedAt: number | null
  limitsStatus: 'unknown' | 'ready' | 'unavailable'
}
export const emptyLive = (): LiveSnapshot => ({
  run: {
    status: 'idle',
    outputCharacters: 0,
    reasoningCharacters: 0,
    outputChunks: 0,
    measured: {},
    updatedAt: null,
  },
  weekly: null,
  primary: null,
  limitsUpdatedAt: null,
  limitsStatus: 'unknown',
})
export const identifier = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(value) ? value : undefined

function limitWindow(value: unknown): LimitWindow | null {
  const window = objectFrom(value)
  const duration = tokenNumber(window.windowDurationMins)
  if (
    typeof window.usedPercent !== 'number' ||
    !Number.isFinite(window.usedPercent) ||
    duration === undefined ||
    duration === 0
  )
    return null
  return {
    remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)),
    windowDurationMins: duration,
    resetsAt: tokenNumber(window.resetsAt) ?? null,
  }
}

/** Both IPC ingress and Main re-project state; raw text never crosses our bridge. */
export function sanitizeLive(value: unknown): LiveSnapshot {
  const state = objectFrom(value)
  const run = objectFrom(state.run)
  const validStatus = ['idle', 'working', 'streaming', 'completed', 'interrupted', 'failed']
  const window = (value: unknown) => {
    const item = objectFrom(value)
    return limitWindow({
      ...item,
      usedPercent:
        typeof item.remainingPercent === 'number' ? 100 - item.remainingPercent : undefined,
    })
  }
  return {
    run: {
      status: validStatus.includes(String(run.status)) ? (run.status as LiveRun['status']) : 'idle',
      outputCharacters: tokenNumber(run.outputCharacters) ?? 0,
      reasoningCharacters: tokenNumber(run.reasoningCharacters) ?? 0,
      outputChunks: tokenNumber(run.outputChunks) ?? 0,
      model: identifier(run.model),
      provider: identifier(run.provider),
      serviceTier: identifier(run.serviceTier),
      measured: normalizeAppServerUsage({
        inputTokens: objectFrom(run.measured).inputTokens,
        outputTokens: objectFrom(run.measured).outputTokens,
        cachedInputTokens: objectFrom(run.measured).promptCacheHitTokens,
      }),
      updatedAt: tokenNumber(run.updatedAt) ?? null,
    },
    weekly: window(state.weekly),
    primary: window(state.primary),
    limitsUpdatedAt: tokenNumber(state.limitsUpdatedAt) ?? null,
    limitsStatus: ['ready', 'unavailable'].includes(String(state.limitsStatus))
      ? (state.limitsStatus as LiveSnapshot['limitsStatus'])
      : 'unknown',
  }
}

export function createLiveObserver(publish: (snapshot: LiveSnapshot) => void, now = Date.now) {
  let state = emptyLive()
  let activeKey = ''
  let activeTurn = ''
  const models = new Map<string, ModelIdentity>()
  const turns = new Map<string, ModelIdentity>()
  const pending = new Map<
    string,
    { method: string; thread?: string; model?: string; serviceTier?: string; at: number }
  >()
  const key = (host: string, thread: string) => JSON.stringify([host, thread])
  const requestKey = (host: string, id: unknown) => JSON.stringify([host, id])
  const emit = () => publish(sanitizeLive(state))
  const trim = <T>(map: Map<string, T>, limit = 1000) => {
    if (map.size >= limit) map.delete(map.keys().next().value!)
  }
  function observeRequest(value: unknown) {
    const envelope = objectFrom(value)
    if (envelope.type !== 'mcp-request' || typeof envelope.hostId !== 'string') return
    const request = objectFrom(envelope.request)
    if (
      !['thread/start', 'thread/resume', 'thread/fork', 'turn/start'].includes(
        String(request.method),
      )
    )
      return
    if (typeof request.id !== 'string' && typeof request.id !== 'number') return
    const params = objectFrom(request.params)
    for (const [id, item] of pending) if (now() - item.at > 120000) pending.delete(id)
    trim(pending)
    pending.set(requestKey(envelope.hostId, request.id), {
      method: String(request.method),
      thread: typeof params.threadId === 'string' ? params.threadId : undefined,
      model: identifier(params.model),
      serviceTier: params.serviceTier === null ? 'default' : identifier(params.serviceTier),
      at: now(),
    })
  }
  function observe(value: unknown) {
    const envelope = objectFrom(value)
    if (typeof envelope.hostId !== 'string') return
    const host = envelope.hostId
    if (envelope.type === 'mcp-response') {
      const message = objectFrom(envelope.message)
      const id = requestKey(host, message.id)
      const request = pending.get(id)
      pending.delete(id)
      if (message.error) return
      const result = objectFrom(message.result)
      const thread = objectFrom(result.thread)
      if (typeof thread.id === 'string' && identifier(result.model)) {
        const threadKey = key(host, thread.id)
        trim(models)
        models.set(threadKey, {
          model: identifier(result.model),
          provider: identifier(result.modelProvider),
          serviceTier: identifier(result.serviceTier),
        })
        if (activeKey === threadKey) {
          state.run = {
            ...state.run,
            ...(turns.get(JSON.stringify([host, thread.id, activeTurn])) ?? models.get(threadKey)),
          }
          emit()
        }
      }
      if (request?.method === 'turn/start' && request.thread) {
        const threadKey = key(host, request.thread)
        const turn = objectFrom(result.turn)
        if (typeof turn.id === 'string') {
          const model = {
            ...models.get(threadKey),
            ...(request.model ? { model: request.model } : {}),
            ...(request.serviceTier ? { serviceTier: request.serviceTier } : {}),
          }
          trim(turns)
          turns.set(JSON.stringify([host, request.thread, turn.id]), model)
          if (activeKey === threadKey && (!activeTurn || activeTurn === turn.id)) {
            state.run = { ...state.run, ...model }
            emit()
          }
        }
      }
      return
    }
    if (envelope.type !== 'mcp-notification') return
    const params = objectFrom(envelope.params)
    if (envelope.method === 'account/rateLimits/updated') {
      if (host !== 'local') return
      receiveLimits(params)
      return
    }
    if (envelope.method === 'account/updated') {
      if (host !== 'local') return
      activeKey = ''
      activeTurn = ''
      models.clear()
      turns.clear()
      pending.clear()
      state = { ...emptyLive(), limitsUpdatedAt: now() }
      emit()
      return
    }
    if (typeof params.threadId !== 'string') return
    const threadKey = key(host, params.threadId)
    const turn = objectFrom(params.turn)
    const turnId =
      typeof params.turnId === 'string' ? params.turnId : typeof turn.id === 'string' ? turn.id : ''
    const model =
      turns.get(JSON.stringify([host, params.threadId, turnId])) ?? models.get(threadKey) ?? {}
    if (envelope.method === 'turn/started') {
      if (activeKey === threadKey && activeTurn === turnId && turnId && state.run.status !== 'idle')
        return
      activeKey = threadKey
      activeTurn = turnId
      state.run = { ...emptyLive().run, ...model, status: 'working', updatedAt: now() }
      emit()
      return
    }
    if (envelope.method === 'thread/tokenUsage/updated') {
      if (!activeKey) {
        activeKey = threadKey
        activeTurn = turnId
      }
      if (activeKey !== threadKey || (activeTurn && turnId && activeTurn !== turnId)) return
      state.run = {
        ...state.run,
        ...model,
        measured: normalizeAppServerUsage(objectFrom(params.tokenUsage).last),
        updatedAt: now(),
      }
      emit()
      return
    }
    if (threadKey !== activeKey) return
    if (activeTurn && turnId && activeTurn !== turnId) return
    if (envelope.method === 'turn/completed') {
      state.run = {
        ...state.run,
        status: ['completed', 'interrupted', 'failed'].includes(String(turn.status))
          ? (turn.status as LiveRun['status'])
          : 'completed',
        updatedAt: now(),
      }
      emit()
      return
    }
    if (['completed', 'interrupted', 'failed'].includes(state.run.status)) return
    if (
      envelope.method === 'item/started' &&
      ['commandExecution', 'mcpToolCall'].includes(String(objectFrom(params.item).type))
    ) {
      state.run = { ...state.run, status: 'working', updatedAt: now() }
      emit()
      return
    }
    const output = envelope.method === 'item/agentMessage/delta'
    const reasoning = ['item/reasoning/summaryTextDelta', 'item/reasoning/textDelta'].includes(
      String(envelope.method),
    )
    if ((!output && !reasoning) || typeof params.delta !== 'string') return
    // Count code points, discarding text immediately. No tokenizer guess or content buffer.
    const length = Array.from(params.delta).length
    state.run = {
      ...state.run,
      status: output ? 'streaming' : 'working',
      outputCharacters: state.run.outputCharacters + (output ? length : 0),
      reasoningCharacters: state.run.reasoningCharacters + (reasoning ? length : 0),
      outputChunks: state.run.outputChunks + (output ? 1 : 0),
      updatedAt: now(),
    }
    emit()
  }
  function receiveLimits(value: unknown) {
    const result = objectFrom(value)
    const byId = objectFrom(result.rateLimitsByLimitId)
    const rates = objectFrom(byId.codex ?? result.rateLimits)
    if (rates.limitId && rates.limitId !== 'codex') return
    const windows = [limitWindow(rates.primary), limitWindow(rates.secondary)].filter(
      (item): item is LimitWindow => item !== null,
    )
    state = {
      ...state,
      weekly: windows.find((item) => item.windowDurationMins === 10080) ?? null,
      primary: windows.find((item) => item.windowDurationMins !== 10080) ?? null,
      limitsUpdatedAt: now(),
      limitsStatus: windows.length ? 'ready' : 'unavailable',
    }
    emit()
  }
  return {
    observe,
    observeRequest,
    receiveLimits,
    limitsUnavailable: () => {
      state = { ...state, limitsStatus: 'unavailable' }
      emit()
    },
    snapshot: () => sanitizeLive(state),
    modelFor: (host: string, thread: string, turn: string): ModelIdentity => ({
      ...(turns.get(JSON.stringify([host, thread, turn])) ?? models.get(key(host, thread))),
    }),
  }
}
