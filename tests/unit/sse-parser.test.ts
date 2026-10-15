import { describe, expect, it } from 'vitest';

import { parseSseStream } from '../../src/interceptor/sse-parser';

describe('parseSseStream', () => {
  it('reads usage and cache-hit metadata from SSE data events', () => {
    const events = parseSseStream(
      'data: {"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_cache_hit_tokens":80}}\n\n',
    );

    expect(events).toEqual([
      {
        inputTokens: 100,
        outputTokens: 20,
        promptCacheHitTokens: 80,
        promptCacheReadTokens: undefined,
        durationMs: undefined,
      },
    ]);
  });
});
