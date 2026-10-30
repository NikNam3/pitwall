<script lang="ts">
  // ERS: the store against the attack level, this lap's deploy and harvest, the trend (spec 8.2, V23).
  import type { WidgetProps } from '../../kit/types.ts';
  import Bar from '../../kit/bar/Bar.svelte';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { roleOrUndefined } from '../../theme/index.ts';
  import { ersRole } from './emphasis.ts';
  import * as text from './text.ts';
  import { BAR_COLS, ersView } from './view.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const view = $derived(ersView(data.ers));
  const full = $derived(size.mode === 'full');
  const hot = $derived(ersRole(data.moment));
  const colour = $derived(roleOrUndefined(hot));
</script>

{#snippet shown(r: keyof typeof view.reasons, known: string)}<TextCell text={known} reason={view.reasons[r]} />{/snippet}

<div class="ers" class:full>
  <div class="row">
    <span class="label">{text.labels.store}</span>
    <span class="bar" title={text.attackLevel(view.level)}><Bar {...view.bar} cols={full ? BAR_COLS.full : BAR_COLS.compact} role="text" /></span>&nbsp;<span class="num" class:hot={hot !== undefined} style:color={colour}>{@render shown('store', view.store)}</span>&nbsp;<span class="flow" class:hot={hot !== undefined} style:color={colour}>{@render shown('flow', view.flow)}</span>
  </div>
  {#if full}
    <div class="row between">
      <span><span class="label">{text.labels.deploy}</span>{text.labels.thisLap}</span>
      <span>{@render shown('deployed', view.deployed)}{text.joint}{text.labels.limit} {view.deployLimit}</span>
    </div>
    <div class="row between">
      <span><span class="label">{text.labels.harvest}</span>{text.labels.thisLap}</span>
      <span>{@render shown('harvested', view.harvested)}</span>
    </div>
  {/if}
  <div class="row">
    {#if full}<span class="label">{text.labels.trend}</span>{/if}
    <span>{@render shown('trend', view.trend)}</span><span>{view.trendJoint}</span><span class:hot={hot !== undefined && view.attackReady}
      ><TextCell text={view.attack} reason={view.reasons.attack} role={view.attackReady ? hot : undefined} /></span
    >
  </div>
</div>

<style>
  .ers {
    white-space: nowrap;
  }
  .between {
    display: flex;
    justify-content: space-between;
  }
  .label {
    display: inline-block;
    min-width: 8ch;
  }
  .ers:not(.full) .label {
    min-width: 5ch;
  }
  .num {
    display: inline-block;
    min-width: 6ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .hot {
    font-weight: bold;
  }
</style>
