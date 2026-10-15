import { parseSseStream } from './sse-parser'
import type { UsageMetrics } from './sse-parser'

export type MetricsObserver = (metrics: UsageMetrics) => void

export function installFetchInterceptor(observer: MetricsObserver): () => void {
  const originalFetch = window.fetch

  window.fetch = async (input, init) => {
    const response = await originalFetch.call(window, input, init)
    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('text/event-stream')) {
      void response
        .clone()
        .text()
        .then((body) => parseSseStream(body).forEach(observer))
    }

    return response
  }

  return () => {
    window.fetch = originalFetch
  }
}
