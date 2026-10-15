import { writable } from 'svelte/store';

import type { UsageMetrics } from '../interceptor/sse-parser';

export interface OverlayState extends UsageMetrics {
  requestCount: number;
  cacheHitCount: number;
}

const initialState: OverlayState = {
  requestCount: 0,
  cacheHitCount: 0,
};

export const overlayStore = writable<OverlayState>(initialState);

export function recordMetrics(metrics: UsageMetrics): void {
  overlayStore.update((state) => ({
    ...state,
    ...metrics,
    requestCount: state.requestCount + 1,
    cacheHitCount: state.cacheHitCount + (metrics.promptCacheHitTokens ? 1 : 0),
  }));
}
