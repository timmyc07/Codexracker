<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { dashboardStore, liveStore, saveSettings, storageError } from '../store'
  import type { Settings } from '../../storage/schema'
  import RuntimeStatus from './RuntimeStatus.svelte'
  import Logo from './Logo.svelte'
  import Missions from './Missions.svelte'

  let panel: HTMLElement
  let position = { x: 16, y: 16 }
  let dragging = false
  let start = { x: 0, y: 0, left: 0, top: 0 }
  let admin = false
  let history = false
  let draft: Settings
  let saving = false
  let formError = ''
  let now = Date.now()
  $: settings = $dashboardStore.settings
  $: if (!dragging) position = clamp(settings.position.x, settings.position.y, settings.minimized)
  $: latest = $dashboardStore.latestSummary
  $: total = $dashboardStore.total
  $: remaining =
    $liveStore.weekly && (!$liveStore.weekly.resetsAt || $liveStore.weekly.resetsAt * 1000 > now)
      ? $liveStore.weekly.remainingPercent
      : undefined
  const number = (value: number | undefined) =>
    value === undefined ? '未知' : value.toLocaleString()
  function clamp(x: number, y: number, minimized = settings.minimized) {
    const width = minimized ? 88 : Math.min(440, window.innerWidth - 16)
    const height = minimized ? 88 : Math.min(panel?.offsetHeight ?? 700, window.innerHeight - 16)
    return {
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      y: Math.max(0, Math.min(y, window.innerHeight - height)),
    }
  }
  async function persistPosition(minimized = settings.minimized) {
    let next = clamp(position.x, position.y, minimized)
    if (minimized) {
      const right = Math.max(0, window.innerWidth - 88)
      next = { ...next, x: next.x < right / 2 ? 0 : right }
    }
    position = next
    const current = get(dashboardStore).settings
    if (
      current.position.x === next.x &&
      current.position.y === next.y &&
      current.minimized === minimized
    )
      return
    await saveSettings({ ...current, position: next, minimized })
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,select')) return
    dragging = true
    start = { x: event.clientX, y: event.clientY, left: position.x, top: position.y }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  function pointerMove(event: PointerEvent) {
    if (!dragging) return
    position = clamp(start.left + event.clientX - start.x, start.top + event.clientY - start.y)
  }
  async function pointerUp() {
    if (!dragging) return
    await persistPosition()
    dragging = false
    position = { ...get(dashboardStore).settings.position }
  }
  function moveByKey(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-10, 0],
      ArrowRight: [10, 0],
      ArrowUp: [0, -10],
      ArrowDown: [0, 10],
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    position = clamp(position.x + move[0], position.y + move[1])
    void persistPosition()
  }
  function openAdmin() {
    draft = structuredClone(get(dashboardStore).settings)
    admin = !admin
    history = false
    formError = ''
  }
  async function submit() {
    saving = true
    formError = ''
    const valid = await saveSettings({
      ...draft,
      position: settings.position,
      minimized: settings.minimized,
    })
    saving = false
    if (valid) admin = false
    else formError = '請輸入 0.3 至 1 之間的不透明度。'
  }
  onMount(() => {
    const clock = setInterval(() => {
      now = Date.now()
    }, 60000)
    const resize = () => {
      void persistPosition()
    }
    const size = new ResizeObserver(() => {
      if (!dragging) void persistPosition()
    })
    size.observe(panel)
    window.addEventListener('resize', resize)
    return () => {
      clearInterval(clock)
      size.disconnect()
      window.removeEventListener('resize', resize)
    }
  })
</script>

<section
  bind:this={panel}
  class="hud"
  class:minimized={settings.minimized}
  style:left={`${position.x}px`}
  style:top={`${position.y}px`}
  style:opacity={settings.opacity}
  aria-label="TokenTracker 用量追蹤"
>
  {#if settings.minimized}
    <button
      class="restore"
      aria-label="展開用量追蹤"
      title={`TokenTracker · 本週剩餘 ${remaining === undefined ? '待同步' : `${Math.round(remaining)}%`}`}
      onclick={() => persistPosition(false)}
    >
      <span class="jelly" class:low={remaining !== undefined && remaining <= 20}>
        <span class="liquid" style:height={`${remaining ?? 0}%`}></span>
        <span class="bubble-logo"><Logo /></span>
        <strong data-testid="bubble-remaining"
          >{remaining === undefined ? '—' : `${Math.round(remaining)}%`}</strong
        >
        <span class="bubble-caption"
          >{$liveStore.limitsStatus === 'unavailable'
            ? '上次剩餘'
            : remaining === undefined
              ? '待同步'
              : '本週剩餘'}</span
        >
      </span>
    </button>
  {:else}
    <header
      role="toolbar"
      tabindex="0"
      aria-label="拖曳或方向鍵移動用量面板"
      onkeydown={moveByKey}
      onpointerdown={pointerDown}
      onpointermove={pointerMove}
      onpointerup={pointerUp}
      onpointercancel={pointerUp}
    >
      <div class="brand">
        <span class="brand-logo"><Logo /></span>
        <div><strong>TokenTracker</strong><small>每一點額度，都有好去處。</small></div>
      </div>
      <div class="actions">
        <button
          aria-label="本機紀錄"
          aria-expanded={history}
          onclick={() => {
            history = !history
            admin = false
          }}>紀錄</button
        >
        <button aria-label="管理設定" aria-expanded={admin} onclick={openAdmin}>設定</button>
        <button aria-label="最小化" onclick={() => persistPosition(true)}>−</button>
      </div>
    </header>
    <div class="content">
      {#if $storageError}<p class="error" role="alert">{$storageError}</p>{/if}
      <div class="token-totals" aria-label="Token 統計">
        <div>
          <span>累計 Token</span><strong data-testid="total-tokens"
            >{number(total.totalTokens)}</strong
          ><small>本機追蹤總計</small>
        </div>
        <div>
          <span>今日 Token</span><strong data-testid="today-tokens"
            >{number($dashboardStore.today.totalTokens)}</strong
          ><small>依本機日期統計</small>
        </div>
      </div>
      <RuntimeStatus {now} />
      <Missions {now} />
      <details class="breakdown">
        <summary>Token 用量明細</summary>
        <table aria-label="實測 Token 用量">
          <thead><tr><th>實測 Token</th><th>最近增量</th><th>本機累計</th></tr></thead>
          <tbody>
            <tr
              ><th>輸入</th><td data-testid="latest-input">{number(latest.inputTokens)}</td><td
                data-testid="total-input">{number(total.inputTokens)}</td
              ></tr
            >
            <tr
              ><th>輸出</th><td data-testid="latest-output">{number(latest.outputTokens)}</td><td
                data-testid="total-output">{number(total.outputTokens)}</td
              ></tr
            >
            <tr
              ><th>快取輸入</th><td>{number(latest.promptCacheHitTokens)}</td><td
                >{number(total.promptCacheHitTokens)}</td
              ></tr
            >
          </tbody>
        </table>
        <div class="counts">
          <span>用量更新 <b data-testid="updates">{total.usageUpdateCount}</b> 次</span><span
            >快取命中 <b>{total.cacheHitCount}</b> 次</span
          >
        </div>
        <p class="note">快取已包含在輸入中 · 累計為本機追蹤紀錄</p>
      </details>
      {#if admin && draft}
        <form
          onsubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          aria-label="顯示設定"
        >
          <h2>TokenTracker 顯示設定</h2>
          <label
            >面板不透明度 <input
              aria-label="面板不透明度"
              type="number"
              min="0.3"
              max="1"
              step="0.01"
              bind:value={draft.opacity}
              required
            /></label
          >
          {#if formError}<p class="error" role="alert">{formError}</p>{/if}
          <div class="actions">
            <button type="submit" disabled={saving}>{saving ? '儲存中…' : '儲存設定'}</button
            ><button type="button" onclick={() => (admin = false)}>取消</button>
          </div>
        </form>
      {/if}
      {#if history}
        <div class="history">
          <h2>最近 20 筆本機紀錄</h2>
          {#each $dashboardStore.recent as record, index (index)}
            <article>
              <time>{new Date(record.recordedAt).toLocaleString()}</time>
              <div>
                {record.model ?? '未知模型'} · 輸入 {number(record.inputTokens)} · 輸出 {number(
                  record.outputTokens,
                )} · 快取 {number(record.promptCacheHitTokens)}
              </div>
            </article>
          {:else}<p>尚未收到新的用量增量。</p>{/each}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  .hud {
    position: fixed;
    width: min(440px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow: auto;
    pointer-events: auto;
    color: #513e64;
    font:
      15px/1.6 'Segoe UI',
      'Microsoft JhengHei',
      sans-serif;
    background: linear-gradient(145deg, #fdfbff, #f5edfc);
    border: 1px solid #fff;
    border-radius: 28px;
    box-shadow:
      0 16px 44px #62478226,
      inset 0 0 0 1px #e9dff4;
    scrollbar-width: thin;
    scrollbar-color: #d6c3ea transparent;
  }
  .hud.minimized {
    width: 88px;
    height: 88px;
    border: 0;
    background: transparent;
    box-shadow: none;
    overflow: visible;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 20px 18px 12px;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .brand strong {
    font-size: 20px;
    letter-spacing: -0.6px;
    line-height: 1.3;
  }
  small {
    display: block;
    font-size: 13px;
    color: #745e86;
  }
  .brand small {
    font-size: 12px;
  }
  .brand-logo {
    flex-shrink: 0;
    width: 43px;
    height: 43px;
    padding: 5px;
    color: #6b4a8b;
    background: linear-gradient(145deg, #f8eeff, #cfb4ef);
    border-radius: 15px;
    box-shadow:
      inset 0 2px 3px #fff,
      0 3px 6px #8055a51c;
  }
  .content {
    padding: 0 18px 18px;
  }
  .actions {
    display: flex;
    gap: 5px;
  }
  button,
  input {
    font: inherit;
    color: #61457c;
    background: #fffaff;
    border: 1px solid #ddcce9;
    border-radius: 11px;
    padding: 6px 9px;
  }
  header button {
    padding: 5px 7px;
    font-size: 13px;
    min-width: 30px;
  }
  button {
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.15s,
      transform 0.15s;
  }
  button:hover {
    background: #ecddfb;
    transform: translateY(-1px);
  }
  button:focus-visible,
  input:focus-visible,
  summary:focus-visible {
    outline: 2px solid #9573bd;
    outline-offset: 3px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .restore {
    display: block;
    width: 88px;
    height: 88px;
    padding: 5px;
    border: 0;
    background: transparent;
    border-radius: 50%;
    transition: transform 0.5s cubic-bezier(0.34, 1.8, 0.5, 1);
  }
  .restore:hover {
    transform: translateY(-3px) scale(1.07);
    background: transparent;
  }
  .restore:active {
    transform: scale(1.15, 0.8);
  }
  .jelly {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 78px;
    height: 78px;
    overflow: hidden;
    color: #503568;
    border: 1px solid #ffffffcf;
    border-radius: 48% 52% 46% 54% / 47% 46% 54% 53%;
    background:
      radial-gradient(ellipse at 26% 16%, #fff 0%, #f6ecffbd 24%, transparent 55%),
      linear-gradient(140deg, #e9d9ff, #d8b8f0 60%, #efc8e4);
    box-shadow:
      inset 2px 4px 7px #fff,
      inset -4px -6px 9px #a076c54a,
      0 6px 13px #8357a534;
    animation: jelly-breathe 4s ease-in-out infinite;
  }
  .jelly::after {
    content: '';
    position: absolute;
    top: 7px;
    left: 14px;
    width: 24px;
    height: 10px;
    border-radius: 50%;
    background: #ffffffb3;
    transform: rotate(-28deg);
    filter: blur(1px);
    pointer-events: none;
  }
  .liquid {
    position: absolute;
    z-index: -1;
    bottom: 0;
    left: -30%;
    width: 160%;
    background: linear-gradient(#bd91e76b, #b889d787);
    border-radius: 42% 46% 0 0;
    transition: height 0.8s ease;
    animation: water-sway 5s ease-in-out infinite alternate;
  }
  .jelly.low .liquid {
    background: linear-gradient(#e5a2c67a, #dca4c8a6);
  }
  .bubble-logo {
    width: 25px;
    height: 25px;
    margin-top: -1px;
  }
  .jelly > strong {
    font-size: 23px;
    line-height: 1.1;
    font-weight: 800;
    letter-spacing: -0.7px;
    font-variant-numeric: tabular-nums;
  }
  .bubble-caption {
    font-size: 11px;
    font-weight: 600;
    line-height: 1.5;
  }
  @keyframes jelly-breathe {
    0%,
    100% {
      transform: translateY(0) scale(1, 1);
      border-radius: 48% 52% 46% 54% / 47% 46% 54% 53%;
    }
    45% {
      transform: translateY(-2px) scale(0.97, 1.03);
      border-radius: 52% 48% 54% 46% / 52% 54% 46% 48%;
    }
    70% {
      transform: translateY(1px) scale(1.03, 0.97);
    }
  }
  @keyframes water-sway {
    from {
      transform: rotate(-5deg) translateX(-2%);
    }
    to {
      transform: rotate(5deg) translateX(2%);
    }
  }
  .token-totals {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin: 3px 0 16px;
  }
  .token-totals > div {
    min-width: 0;
    padding: 14px 15px;
    background: #fffaff;
    border: 1px solid #e8dcf1;
    border-radius: 20px;
  }
  .token-totals > div:last-child {
    background: #efe6f9;
    border-color: #e1d3ed;
  }
  .token-totals span {
    font-size: 14px;
    color: #715683;
  }
  .token-totals strong {
    display: block;
    color: #50376b;
    font-size: 27px;
    line-height: 1.4;
    letter-spacing: -0.8px;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .breakdown {
    margin-top: 16px;
    border-top: 1px solid #e5daee;
    padding-top: 10px;
  }
  summary {
    cursor: pointer;
    color: #684c7d;
    font-size: 14px;
    padding: 3px 0;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 5px;
    table-layout: fixed;
    font-variant-numeric: tabular-nums;
    font-size: 14px;
  }
  th,
  td {
    text-align: right;
    padding: 9px 6px;
    overflow-wrap: anywhere;
    background: #fffafed9;
  }
  th:first-child {
    text-align: left;
    border-radius: 12px 0 0 12px;
    padding-left: 10px;
    width: 25%;
  }
  td:last-child {
    border-radius: 0 12px 12px 0;
    padding-right: 10px;
    font-weight: 650;
  }
  th {
    font-weight: 500;
    color: #715683;
  }
  thead th {
    font-size: 13px;
    padding: 3px 6px;
    background: transparent;
  }
  tbody tr:last-child td,
  tbody tr:last-child th {
    color: #79529d;
    background: #ede0fa;
  }
  .counts {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 4px 0;
    font-size: 13px;
    color: #745d85;
  }
  b {
    color: #684780;
  }
  .note {
    margin: 8px 0 0;
    color: #745d85;
    font-size: 13px;
    text-align: center;
  }
  .error {
    color: #a33f68;
    font-size: 14px;
  }
  form,
  .history {
    margin-top: 14px;
    padding: 14px;
    background: #fff9fe;
    border: 1px solid #e9dcf4;
    border-radius: 18px;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 8px;
  }
  label {
    display: grid;
    gap: 4px;
    margin: 8px 0;
  }
  input {
    width: 100%;
    min-width: 0;
  }
  .history {
    max-height: 260px;
    overflow: auto;
  }
  article {
    padding: 9px 0;
    border-bottom: 1px dashed #e4d6f0;
  }
  time {
    color: #745d85;
    font-size: 13px;
  }
  article div {
    overflow-wrap: anywhere;
    font-size: 14px;
  }
  @media (max-width: 400px) {
    header {
      flex-wrap: wrap;
    }
    header .actions {
      margin-left: auto;
    }
    .brand strong {
      font-size: 19px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    button,
    .liquid {
      transition: none;
    }
    .jelly,
    .liquid {
      animation: none;
    }
  }
</style>
