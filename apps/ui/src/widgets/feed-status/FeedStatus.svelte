<script lang="ts">
  // Connection health of the feed: one line in compact mode, the counters in full mode (spec 6.5).
  import { unknown } from '@pitwall/domain';
  import type { WidgetProps } from '../../kit/types.ts';
  import Value from '../../kit/values/Value.svelte';
  import { formatCount, formatLoss, formatMillis, formatRate } from '../../kit/values/format.ts';
  import { role } from '../../theme/index.ts';
  import { separator } from '../../kit/text.ts';
  import { connectionRole } from './emphasis.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, options, size }: WidgetProps<typeof widget> = $props();

  const feed = $derived(data.feed);
  const colour = $derived.by(() => {
    const r = connectionRole(feed);
    return r === undefined ? undefined : role(r);
  });
  const state = $derived(!feed.connected ? text.disconnected : feed.stale ? text.stale : text.connected);
  const full = $derived(size.mode === 'full');
  const identity = (s: string): string => s;
  const playerCar = (id: number): string => `#${id}`;
</script>

<div class="feed">
  <div class="line">
    <span class="state" style:color={colour}>{state}</span>{separator}<Value value={feed.lossPercent} format={formatLoss} />{separator}<Value
      value={feed.packetsPerSecond}
      format={formatRate}
    />
  </div>
  {#if data.session}
    <div class="line dim">
      <Value value={data.session.session.kind} format={identity} align="left" />{separator}<Value
        value={data.session.session.trackId}
        format={text.trackLabel}
        align="left"
      />
    </div>
  {/if}
  {#if full}
    <div class="line">{text.labels.latency} <Value value={feed.latencyMs ?? unknown('notReceived')} format={formatMillis} /></div>
    <div class="line">{text.labels.late} <Value value={feed.latePackets} format={formatCount} /></div>
    <div class="line">{text.labels.decodeErrors} <Value value={feed.decodeErrors} format={formatCount} /></div>
    {#if data.session}
      <div class="line">{text.labels.playerCar} <Value value={data.session.playerCar} format={playerCar} /></div>
    {/if}
    {#if options.details}
      <div class="line">{text.labels.cadence} <Value value={feed.cadenceMs ?? unknown('notReceived')} format={formatMillis} /></div>
      <div class="line">{text.labels.wrongFormat} <Value value={feed.wrongFormat ?? 0} format={formatCount} /></div>
    {/if}
  {/if}
</div>

<style>
  .feed {
    white-space: nowrap;
  }
  .dim {
    color: var(--pw-textDim);
  }
</style>
