import type { Dashboard } from './overlay/summary'
import type { Settings } from './storage/schema'
import type { LiveSnapshot } from './interceptor/live'

export const channels = {
  record: 'codexracker:record',
  snapshot: 'codexracker:snapshot',
  settings: 'codexracker:settings',
  changed: 'codexracker:changed',
  live: 'codexracker:live',
  liveSnapshot: 'codexracker:live-snapshot',
  liveChanged: 'codexracker:live-changed',
} as const
export interface TrackerBridge {
  snapshot(): Promise<Dashboard>
  saveSettings(settings: Settings): Promise<Dashboard>
  subscribe(listener: (snapshot: Dashboard | null) => void): () => void
  liveSnapshot(): Promise<LiveSnapshot>
  subscribeLive(listener: (snapshot: LiveSnapshot) => void): () => void
  refreshLimits(): Promise<void>
}
declare global {
  interface Window {
    codexracker: TrackerBridge
  }
}
