import { mount } from 'svelte'

import Hud from './components/Hud.svelte'
import { dashboardStore, liveStore, storageError } from './store'

export function mountOverlay(target: HTMLElement = document.body): ShadowRoot {
  const existing = target.querySelector('codex-token-cache-hud')?.shadowRoot
  if (existing) return existing
  const host = document.createElement('codex-token-cache-hud')
  const shadowRoot = host.attachShadow({ mode: 'open' })
  target.appendChild(host)
  // Reset inherited host styles; component CSS is injected inside this Shadow Root.
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  mount(Hud, { target: shadowRoot })
  let revision = 0
  const unsubscribe = window.codexracker.subscribe((snapshot) => {
    revision += 1
    if (snapshot) {
      dashboardStore.set(snapshot)
      storageError.set('')
    } else storageError.set('用量未能寫入本機。請檢查檔案權限與磁碟空間。')
  })
  const before = revision
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
  void window.codexracker.snapshot().then(
    (snapshot) => {
      if (before === revision) dashboardStore.set(snapshot)
    },
    () => storageError.set('本機紀錄讀取失敗。請確認檔案完整並重新啟動。'),
  )
  window.addEventListener('pagehide', unsubscribe, { once: true })
  window.addEventListener('pagehide', unsubscribeLive, { once: true })
  return shadowRoot
}
