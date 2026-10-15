<script lang="ts">
  import { overlayStore } from '../store';
</script>

<section class="hud" aria-label="Token cache HUD">
  <header>Token Cache</header>
  <dl>
    <div>
      <dt>Requests</dt>
      <dd>{$overlayStore.requestCount}</dd>
    </div>
    <div>
      <dt>Cache hits</dt>
      <dd>{$overlayStore.cacheHitCount}</dd>
    </div>
    <div>
      <dt>Cached tokens</dt>
      <dd>{$overlayStore.promptCacheHitTokens ?? 0}</dd>
    </div>
  </dl>
</section>

<style>
  .hud {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    min-width: 160px;
    padding: 12px;
    color: #e8eefc;
    font: 12px/1.4 system-ui, sans-serif;
    background: rgb(20 25 38 / 78%);
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 12px;
    box-shadow: 0 8px 28px rgb(0 0 0 / 24%);
    backdrop-filter: blur(14px);
    user-select: none;
  }

  header {
    margin-bottom: 8px;
    font-weight: 700;
  }

  dl,
  div {
    display: grid;
    gap: 6px;
  }

  div {
    grid-template-columns: 1fr auto;
  }

  dt {
    color: #aebbd7;
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
