import { writable } from 'svelte/store'
import { dashboard } from './summary'
import { defaultSettings } from '../storage/schema'
import type { Settings } from '../storage/schema'
import { emptyLive } from '../interceptor/live'

export const dashboardStore = writable(dashboard([], defaultSettings()))
export const storageError = writable('')
export const liveStore = writable(emptyLive())
export const nowStore = writable(Date.now())

export async function saveSettings(settings: Settings) {
  try {
    const snapshot = await window.codexracker.saveSettings(settings)
    dashboardStore.set(snapshot)
    storageError.set('')
    return true
  } catch {
    storageError.set('設定未儲存。請檢查顯示設定與本機檔案權限後重試。')
    return false
  }
}
