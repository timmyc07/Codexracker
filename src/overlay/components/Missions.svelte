<script lang="ts">
  import { dashboardStore, liveStore } from '../store'
  import { dailyMission } from '../missions'
  export let now: number
  $: mission = dailyMission($liveStore.weekly, $dashboardStore.quotaBaseline, new Date(now))
  const percent = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
</script>

<section class="missions" aria-label="額度任務">
  <div class="heading">
    <h2>把額度，變成完成的事</h2>
    <span>每日任務</span>
  </div>
  {#if mission}
    <div class="mission-title">
      <span class="check" class:complete={mission.progress >= 100} aria-hidden="true"
        >{mission.progress >= 100 ? '✓' : '↗'}</span
      >
      <div>
        <strong>{mission.progress >= 100 ? '今日目標完成！' : '今天的額度小任務'}</strong>
        <p>重設前用完 · 還有 {mission.daysLeft} 天</p>
      </div>
      <b data-testid="daily-target">{percent(mission.target)}<small>%／天</small></b>
    </div>
    <div
      class="track"
      role="progressbar"
      aria-label="今日額度任務進度"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={mission.progress}
    >
      <div style:width={`${mission.progress}%`}></div>
    </div>
    <div class="progress-copy">
      <span>今日已用 <b data-testid="daily-used">{percent(mission.used)}%</b></span><strong
        data-testid="daily-needed"
        >{mission.progress >= 100
          ? '今天做得很好 ✧'
          : `再用 ${percent(mission.remaining)}% 達標`}</strong
      >
    </div>
    <p class="note">
      {mission.synced
        ? '每日 00:00 歸零今日進度，未用完額度會分攤至剩餘天數。'
        : '正在保存今日起點，暫顯示日均建議。'}每日目標＝當日起點剩餘額度 ÷ 剩餘天數。
    </p>
    {#if $liveStore.limitsStatus !== 'ready'}<p class="note">
        額度尚未刷新，任務進度以上次同步資料為準。
      </p>{/if}
  {:else}
    <p class="waiting" data-testid="daily-target">等待同步本週額度與重設時間，即可安排每日任務。</p>
  {/if}
  <p class="example">7 天用完 100% <span>每天約 <b>14.29%</b></span></p>
</section>

<style>
  .missions {
    padding: 18px;
    margin-top: 16px;
    border: 1px solid #dfd3ef;
    border-radius: 22px;
    background: linear-gradient(120deg, #f0e7fc, #fbf5ff);
  }
  .heading,
  .mission-title,
  .progress-copy,
  .example {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  h2 {
    font-size: 16px;
    margin: 0;
    color: #4e3667;
  }
  .heading > span {
    font-size: 13px;
    color: #73528f;
    white-space: nowrap;
  }
  .mission-title {
    margin-top: 18px;
  }
  .mission-title > div {
    flex: 1;
  }
  .mission-title strong {
    font-size: 15px;
  }
  .mission-title p {
    margin: 2px 0 0;
    font-size: 13px;
    color: #715c83;
  }
  .mission-title > b {
    font-size: 27px;
    line-height: 1.15;
    color: #705097;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  small {
    display: block;
    font-size: 13px;
    font-weight: 500;
  }
  .check {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 12px;
    color: #79569d;
    background: #fff9ff;
    font-size: 22px;
  }
  .check.complete {
    color: #356955;
    background: #e1f4ea;
  }
  .track {
    height: 10px;
    background: #dfd2ee;
    border-radius: 10px;
    margin: 16px 0 9px;
    overflow: hidden;
  }
  .track > div {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #a184cc, #c5a1dd);
    transition: width 0.3s;
  }
  .progress-copy {
    font-size: 13px;
  }
  .progress-copy strong {
    color: #72508f;
  }
  .note {
    font-size: 13px;
    line-height: 1.6;
    color: #705d80;
    margin: 10px 0 0;
  }
  .example {
    margin: 14px 0 0;
    border-top: 1px solid #dfd3ef;
    padding-top: 12px;
    font-size: 13px;
    color: #705d80;
  }
  .example b {
    color: #654582;
  }
  .waiting {
    font-size: 14px;
    color: #705d80;
  }
  @media (prefers-reduced-motion: reduce) {
    .track > div {
      transition: none;
    }
  }
</style>
