import { createParser } from 'eventsource-parser'
import { hasMetrics, objectFrom, sanitizeMetrics } from './usage'
import type { UsageMetrics } from './usage'

/** Responses terminal usage and Chat Completions usage-only final chunks. */
export function parseSseEvent(data: string): UsageMetrics | undefined {
  try {
    const event = objectFrom(JSON.parse(data))
    let usage: Record<string, unknown>
    let metrics: UsageMetrics
    if (event.type === 'response.completed') {
      usage = objectFrom(objectFrom(event.response).usage)
      metrics = sanitizeMetrics({
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        promptCacheHitTokens: objectFrom(usage.input_tokens_details).cached_tokens,
      })
    } else if (
      event.object === 'chat.completion.chunk' &&
      Array.isArray(event.choices) &&
      event.choices.length === 0
    ) {
      usage = objectFrom(event.usage)
      metrics = sanitizeMetrics({
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        promptCacheHitTokens: objectFrom(usage.prompt_tokens_details).cached_tokens,
      })
    } else return undefined
    return hasMetrics(metrics) ? metrics : undefined
  } catch {
    return undefined
  }
}

export function createUsageSseParser(observer: (metrics: UsageMetrics) => void) {
  let stopped = false
  let ended = false
  const parser = createParser({
    maxBufferSize: 1024 * 1024,
    onError(error) {
      if (error.type === 'max-buffer-size-exceeded') stopped = true
    },
    onEvent(event) {
      if (stopped) return
      if (event.data.trim() === '[DONE]') {
        stopped = true
        return
      }
      const metrics = parseSseEvent(event.data)
      if (metrics) {
        stopped = true
        observer(metrics)
      }
    },
  })
  return {
    feed(chunk: string) {
      if (!stopped && !ended) parser.feed(chunk)
    },
    end() {
      // SSE requires a blank line: incomplete trailing events are discarded at EOF.
      ended = true
      parser.reset()
    },
  }
}

/** Decode incrementally so UTF-8 characters may also span byte chunks. */
export async function consumeUsageSse(
  stream: ReadableStream<Uint8Array>,
  observer: (metrics: UsageMetrics) => void,
): Promise<void> {
  const parser = createUsageSseParser(observer)
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
    }
    parser.feed(decoder.decode())
  } finally {
    parser.end()
    reader.releaseLock()
  }
}
