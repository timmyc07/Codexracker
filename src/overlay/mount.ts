import { mount } from 'svelte'

import Hud from './components/Hud.svelte'
import { dashboardStore, liveStore, nowStore, storageError } from './store'
import { localDay } from './summary'

export async function mountOverlay(target: HTMLElement = document.body): Promise<ShadowRoot> {
  const existing = target.querySelector('codex-token-cache-hud')?.shadowRoot
  if (existing) return existing
  const host = document.createElement('codex-token-cache-hud')
  const shadowRoot = host.attachShadow({ mode: 'open' })
  target.appendChild(host)
  // Reset inherited host styles; component CSS is injected inside this Shadow Root.
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  let revision = 0
  const unsubscribe = window.codexracker.subscribe((snapshot) => {
    revision += 1
    if (snapshot) {
      dashboardStore.set(snapshot)
      storageError.set('')
    } else storageError.set('用量未能寫入本機。請檢查檔案權限與磁碟空間。')
  })
  let liveRevision = 0
  const unsubscribeLive = window.codexracker.subscribeLive((snapshot) => {
    liveRevision++
    liveStore.set(snapshot)
  })
  const beforeLive = liveRevision
  void window.codexracker.liveSnapshot().then(
    (snapshot) => {
      if (beforeLive === liveRevision) liveStore.set(snapshot)
    },
    () => {},
  )
  let refreshedDay = ''
  const refreshDashboard = () => {
    const before = revision
    return window.codexracker.snapshot().then(
      (snapshot) => {
        refreshedDay = snapshot.todayDate
        if (before === revision) {
          dashboardStore.set(snapshot)
          storageError.set('')
        }
      },
      () => storageError.set('本機紀錄讀取失敗。請確認檔案完整並重新啟動。'),
    )
  }
  // Restore saved settings before resize observers can persist the initial layout.
  await refreshDashboard()
  let clock: ReturnType<typeof setTimeout>
  const refreshClock = () => {
    clearTimeout(clock)
    const now = new Date()
    nowStore.set(now.getTime())
    if (refreshedDay !== localDay(now)) void refreshDashboard()
    clock = setTimeout(refreshClock, 60000 - (now.getTime() % 60000))
  }
  refreshClock()
  mount(Hud, { target: shadowRoot })
  window.addEventListener('focus', refreshClock)
  document.addEventListener('visibilitychange', refreshClock)
  window.addEventListener(
    'pagehide',
    () => {
      clearTimeout(clock)
      window.removeEventListener('focus', refreshClock)
      document.removeEventListener('visibilitychange', refreshClock)
      unsubscribe()
      unsubscribeLive()
    },
    { once: true },
  )
  return shadowRoot
}
