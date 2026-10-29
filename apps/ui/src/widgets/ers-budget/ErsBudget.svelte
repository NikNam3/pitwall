<script lang="ts">
  // ERS: the store against the attack level, this lap's deploy and harvest, the trend (spec 8.2, V23).
  import type { WidgetProps } from '../../kit/types.ts';
  import Bar from '../../kit/bar/Bar.svelte';
  import { unknownReason } from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';
  import { ersRole } from './emphasis.ts';
  import * as text from './text.ts';
  import { ersView } from './view.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const view = $derived(ersView(data.ers));
  const full = $derived(size.mode === 'full');
  const hot = $derived(ersRole(data.moment));
  const colour = $derived(hot === undefined ? undefined : role(hot));
  const why = (r: keyof typeof view.reasons): string | undefined => {
    const reason = view.reasons[r];
    return reason === undefined ? undefined : unknownReason[reason];
  };
</script>

<div class="ers" class:full>
  <div class="row">
    <span class="label">{text.labels.store}</span>
    <span class="bar" title={text.attackLevel(view.level)}><Bar {...view.bar} cols={full ? 18 : 6} role="textDim" /></span>&nbsp;<span class="num" class:hot={hot !== undefined} style:color={colour} title={why('store')}>{view.store}</span>&nbsp;<span class="flow" class:hot={hot !== undefined} style:color={colour} title={why('flow')}>{view.flow}</span>
  </div>
  {#if full}
    <div class="row between">
      <span><span class="label">{text.labels.deploy}</span>{text.labels.thisLap}</span>
      <span title={why('deployed')}>{view.deployed}{view.deployed ? ', ' : ''}{text.labels.limit} {view.deployLimit}</span>
    </div>
    <div class="row between">
      <span><span class="label">{text.labels.harvest}</span>{text.labels.thisLap}</span>
      <span title={why('harvested')}>{view.harvested}</span>
    </div>
  {/if}
  <div class="row">
    {#if full}<span class="label">{text.labels.trend}</span>{/if}
    <span title={why('trend')}>{view.trend}</span>{#if view.attack}<span>,&nbsp;</span><span class:hot={hot !== undefined && view.attackReady} style:color={view.attackReady ? colour : undefined}>{view.attack}</span>{/if}
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
