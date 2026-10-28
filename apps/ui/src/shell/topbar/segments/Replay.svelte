<script lang="ts">
  // The replay transport (spec 8.5), only for a replay feed: pause or play, speed and jump to a lap.
  import * as text from '../../../kit/text.ts';
  import { formatFactor } from '../../../kit/values/format.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
  const SPEEDS = [0.5, 1, 2, 4, 8];
  const status = $derived(bar.replay);
</script>

{#if bar.isReplay && status !== undefined}
  <span class="transport" data-testid="replay-transport">
    <button
      type="button"
      class="pw-button"
      data-testid="replay-pause"
      style:color={role('text')}
      onclick={() => bar.sendReplay({ kind: status.paused ? 'play' : 'pause' })}
    >{status.paused ? text.topBar.paused : text.topBar.playing}</button>
    <select
      class="pw-input"
      data-testid="replay-speed"
      aria-label={text.topBar.speed}
      value={String(status.speed)}
      onchange={(e) => bar.sendReplay({ kind: 'speed', factor: Number(e.currentTarget.value) })}
    >
      {#each SPEEDS as factor (factor)}<option value={String(factor)}>{formatFactor(factor)}</option>{/each}
    </select>
    <label>
      {text.topBar.lap}
      <input
        class="pw-input lap"
        type="number"
        min="1"
        data-testid="replay-lap"
        value={status.playerLap}
        onchange={(e) => {
          // A cleared or invalid field jumps nowhere.
          const lap = e.currentTarget.valueAsNumber;
          if (Number.isInteger(lap) && lap > 0) bar.sendReplay({ kind: 'jumpToLap', lap });
        }}
      />
    </label>
    {#if status.note === 'beyondEnd'}<span style:color={role('warning')}>{text.topBar.beyondEnd}</span>{/if}
  </span>
{/if}

<style>
  .transport {
    display: inline-flex;
    gap: var(--pw-header-pad);
  }
  .lap {
    width: 5ch;
  }
</style>
