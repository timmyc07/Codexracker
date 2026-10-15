import { mount } from 'svelte'

import Hud from './components/Hud.svelte'

export function mountOverlay(target: HTMLElement = document.body): ShadowRoot {
  const host = document.createElement('codex-token-cache-hud')
  const shadowRoot = host.attachShadow({ mode: 'open' })
  target.appendChild(host)
  mount(Hud, { target: shadowRoot })
  return shadowRoot
}
