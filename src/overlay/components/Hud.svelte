<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { dashboardStore, saveSettings, storageError } from '../store'
  import type { Settings } from '../../storage/schema'
  import RuntimeStatus from './RuntimeStatus.svelte'

  let panel: HTMLElement
  let position = { x: 16, y: 16 }
  let dragging = false
  let start = { x: 0, y: 0, left: 0, top: 0 }
  let admin = false
  let history = false
  let draft: Settings
  let saving = false
  let formError = ''
  $: settings = $dashboardStore.settings
  $: if (!dragging) position = clamp(settings.position.x, settings.position.y, settings.minimized)
  $: latest = $dashboardStore.latestSummary
  $: total = $dashboardStore.total
  const number = (value: number | undefined) =>
    value === undefined ? '未知' : value.toLocaleString()
  function clamp(x: number, y: number, minimized = settings.minimized) {
    const width = minimized ? 44 : Math.min(360, window.innerWidth - 16)
    const height = minimized ? 44 : Math.min(panel?.offsetHeight ?? 300, window.innerHeight - 16)
    return {
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      y: Math.max(0, Math.min(y, window.innerHeight - height)),
    }
  }
  async function persistPosition(minimized = settings.minimized) {
    let next = clamp(position.x, position.y, minimized)
    if (minimized) {
      const right = Math.max(0, window.innerWidth - 44)
      next = { ...next, x: next.x < right / 2 ? 0 : right }
    }
    position = next
    await saveSettings({ ...get(dashboardStore).settings, position: next, minimized })
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
    const resize = () => {
      void persistPosition()
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  })
</script>

<section
  bind:this={panel}
  class="hud"
  class:minimized={settings.minimized}
  style:left={`${position.x}px`}
  style:top={`${position.y}px`}
  style:opacity={settings.opacity}
  aria-label="Token 用量追蹤"
>
  {#if settings.minimized}
    <button class="restore" aria-label="展開用量追蹤" onclick={() => persistPosition(false)}
      >QQ</button
    >
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
        <span class="mochi" aria-hidden="true"><i></i><i></i><em>ω</em></span>
        <div><strong>Token 小棉糖</strong><small>陪你一起，慢慢完成 ✧</small></div>
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
      <RuntimeStatus />
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
      {#if admin && draft}
        <form
          onsubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          aria-label="顯示設定"
        >
          <h2>讓小棉糖更適合你</h2>
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
    width: min(360px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow: auto;
    pointer-events: auto;
    color: #5c486f;
    font:
      12px/1.6 'Segoe UI',
      'Microsoft JhengHei',
      sans-serif;
    background: linear-gradient(145deg, #fcf9ff, #f5edff);
    border: 1px solid #fff;
    border-radius: 28px;
    box-shadow:
      0 16px 44px #62478226,
      inset 0 0 0 1px #e9dff4;
    scrollbar-width: thin;
    scrollbar-color: #d6c3ea transparent;
  }
  .hud.minimized {
    width: 44px;
    height: 44px;
    border-radius: 18px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 18px 16px 10px;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  strong {
    font-size: 15px;
    letter-spacing: 0.3px;
  }
  small {
    display: block;
    font-size: 9px;
    color: #8b739e;
    letter-spacing: 0.5px;
  }
  .mochi {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 37px;
    height: 33px;
    background: #e7d6fa;
    border-radius: 48% 48% 40% 40%;
    box-shadow:
      inset 0 3px 3px #fff9,
      0 3px 0 #d6c0ed;
  }
  .mochi::before,
  .mochi::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 4px;
    background: #efbbd6;
    border-radius: 50%;
    top: 21px;
  }
  .mochi::before {
    left: 3px;
  }
  .mochi::after {
    right: 3px;
  }
  .mochi i {
    width: 3px;
    height: 4px;
    border-radius: 50%;
    background: #705289;
  }
  .mochi em {
    position: absolute;
    top: 12px;
    font: 11px system-ui;
    color: #705289;
  }
  .content {
    padding: 10px 16px 16px;
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  button,
  input {
    font: inherit;
    color: #6b5085;
    background: #fffafede;
    border: 1px solid #e4d6f0;
    border-radius: 12px;
    padding: 5px 7px;
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
  input:focus-visible {
    outline: 2px solid #9573bd;
    outline-offset: 2px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .restore {
    width: 100%;
    height: 100%;
    padding: 0;
    font-weight: 700;
    background: #ecddfb;
    border-radius: inherit;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 5px;
    table-layout: fixed;
    font-variant-numeric: tabular-nums;
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
    color: #7b638f;
  }
  thead th {
    font-size: 10px;
    padding: 3px 6px;
    background: transparent;
    color: #8d779e;
  }
  tbody tr:last-child td {
    color: #8b61b3;
    background: #ede0fa;
  }
  tbody tr:last-child th {
    background: #ede0fa;
  }
  .counts {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 4px 0;
    font-size: 10px;
    color: #8b739e;
  }
  b {
    color: #765592;
  }
  .note {
    margin: 8px 0 0;
    color: #8b739e;
    font-size: 10px;
    text-align: center;
  }
  .error {
    color: #a33f68;
  }
  form,
  .history {
    margin-top: 14px;
    padding: 12px;
    background: #fff9fe;
    border: 1px solid #e9dcf4;
    border-radius: 18px;
  }
  h2 {
    font-size: 12px;
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
    max-height: 220px;
    overflow: auto;
  }
  article {
    padding: 9px 0;
    border-bottom: 1px dashed #e4d6f0;
  }
  time {
    color: #8b739e;
    font-size: 10px;
  }
  article div {
    overflow-wrap: anywhere;
  }
  @media (prefers-reduced-motion: reduce) {
    button {
      transition: none;
    }
  }
</style>
