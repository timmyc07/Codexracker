<script lang="ts">
  import { liveStore } from '../store'
  export let now: number
  let refreshing = false
  $: live = $liveStore
  $: run = live.run
  $: remaining =
    live.weekly && (!live.weekly.resetsAt || live.weekly.resetsAt * 1000 > now)
      ? live.weekly.remainingPercent
      : undefined
  const labels = {
    idle: '待機',
    working: '思考／工具處理中',
    streaming: '輸出中',
    completed: '已完成',
    interrupted: '已中止',
    failed: '回應失敗',
  }
  const time = (value: number | null) =>
    value === null ? '尚未取得' : new Date(value).toLocaleTimeString()
  async function refresh() {
    refreshing = true
    try {
      await window.codexracker.refreshLimits()
    } finally {
      refreshing = false
    }
  }
</script>

<div class="runtime">
  <div class="quota-title">
    <strong><span class="eyebrow">WEEKLY BALANCE</span>本週總剩餘額度</strong>
    <strong data-testid="weekly-remaining"
      >{remaining === undefined ? '未知' : `${Math.round(remaining)}%`}</strong
    >
    <button aria-label="更新週額度" disabled={refreshing} onclick={refresh}
      >{refreshing ? '更新中' : '↻'}</button
    >
  </div>
  <div
    class="track"
    role="progressbar"
    aria-label="本週剩餘額度"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={remaining}
  >
    <div style:width={`${remaining ?? 0}%`}></div>
  </div>
  <div class="details">
    {#if live.weekly?.resetsAt}重設：{new Date(live.weekly.resetsAt * 1000).toLocaleString()} ·
    {/if}
    額度更新：{time(live.limitsUpdatedAt)}
    {#if live.limitsStatus === 'unavailable'}
      · 無法刷新，保留上次資料{/if}
  </div>
  {#if live.primary}
    <div class="details">
      {live.primary.windowDurationMins / 60} 小時額度剩餘 {Math.round(
        live.primary.remainingPercent,
      )}%
    </div>
  {/if}
  <details class="session">
    <summary>即時回合狀態</summary>
    <div class="run-title">
      <span class:streaming={run.status === 'streaming'} data-testid="run-status"
        >{labels[run.status]}</span
      ><span>模型 · <b data-testid="live-model">{run.model ?? '未知'}</b></span>
    </div>
    <div class="details" data-testid="stream-progress">
      已輸出 {run.outputCharacters.toLocaleString()} 字 · {run.outputChunks.toLocaleString()} 個串流片段{run.reasoningCharacters
        ? ` · 推理 ${run.reasoningCharacters.toLocaleString()} 字`
        : ''}
    </div>
    <div class="details" data-testid="measured-output">
      本回合實測輸出 Token：{run.measured.outputTokens === undefined
        ? '待服務端回報'
        : run.measured.outputTokens.toLocaleString()}
    </div>
    <div class="details">串流字數不是 Token 數；精確值隨服務端用量通知更新。</div>
  </details>
</div>

<style>
  .runtime {
    margin-bottom: 10px;
    padding: 2px 2px 0;
  }
  .quota-title {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 3px 0;
  }
  .quota-title strong:first-child {
    font-size: 16px;
    font-weight: 600;
  }
  .eyebrow {
    display: block;
    color: #765590;
    font-size: 11px;
    letter-spacing: 1.6px;
    margin-bottom: 2px;
  }
  .quota-title strong:nth-child(2) {
    color: #77539a;
    margin-left: auto;
    font-size: 40px;
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: -1px;
    font-variant-numeric: tabular-nums;
  }
  button {
    font: inherit;
    color: #9471af;
    background: #fff9fe;
    border: 1px solid #e5d6f0;
    border-radius: 50%;
    width: 34px;
    height: 34px;
    font-size: 20px;
    padding: 0;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
  }
  button:focus-visible {
    outline: 2px solid #9573bd;
    outline-offset: 2px;
  }
  .track {
    height: 12px;
    background: #e8dcf4;
    border-radius: 12px;
    overflow: hidden;
    margin: 9px 0 8px;
    box-shadow: inset 0 2px 3px #76549213;
  }
  .track div {
    height: 100%;
    background: linear-gradient(90deg, #c6a8eb, #b797df 70%, #dfb9e8);
    border-radius: inherit;
    transition: width 0.2s ease;
    box-shadow: inset 0 2px 2px #ffffff60;
  }
  .details {
    font-size: 13px;
    color: #705980;
    margin-top: 4px;
    overflow-wrap: anywhere;
  }
  .session {
    margin-top: 12px;
    padding: 9px 12px;
    background: #fffafee8;
    border: 1px solid #eadff2;
    border-radius: 19px;
  }
  .run-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 14px;
    margin-bottom: 7px;
  }
  .run-title > span:first-child {
    flex-shrink: 0;
    border-radius: 20px;
    padding: 3px 8px;
    background: #ece0f8;
    color: #785694;
    font-weight: 600;
  }
  .run-title > span:last-child {
    text-align: right;
    overflow-wrap: anywhere;
    color: #8b739e;
  }
  b {
    color: #70518b;
  }
  summary {
    cursor: pointer;
    font-size: 14px;
    color: #684c7d;
  }
  summary:focus-visible {
    outline: 2px solid #9573bd;
    outline-offset: 3px;
  }
  .run-title {
    margin-top: 10px;
  }
  .run-title > .streaming {
    background: #f6dfee;
    color: #995b85;
  }
  @media (prefers-reduced-motion: reduce) {
    .track div {
      transition: none;
    }
  }
</style>
