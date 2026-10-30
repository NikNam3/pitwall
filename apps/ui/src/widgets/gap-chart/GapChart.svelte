<script lang="ts">
  // The gap chart (V04): each car's gap to a virtual car at the reference pace, per lap, then dotted to its gap now.
  import { carCodeById } from '../../kit/car/car-label.ts';
  import Chart from '../../kit/chart/Chart.svelte';
  import type { WidgetProps } from '../../kit/types.ts';
  import { ourCars } from '../../kit/car/our-cars.ts';
  import { noDataYet } from '../../kit/text.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { formatGapTick } from '../../kit/values/format.ts';
  import { role } from '../../theme/index.ts';
  import { gapSeries, phaseBands } from './series.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const ours = $derived(ourCars(data.session));
  const series = $derived(gapSeries(data.gapper, data.cars, ours));
  const bands = $derived(phaseBands(data.gapper.phases));
  const header = $derived(text.referenceText(data.gapper, (id) => carCodeById(data.cars, id)));
  // The reference line takes one text row; the chart gets the rest.
  const rowPx = $derived(size.px.height / size.rows);
  const chartSize = $derived({ ...size, rows: size.rows - 1, px: { ...size.px, height: Math.max(0, size.px.height - rowPx) } });
</script>

<div class="gap">
  <!-- The parts of the line, a space apart; an unknown part (the lap time, or the reference car's code) is a kit text cell showing its mark there. -->
  <div class="ref" style:color={role('textDim')} style:height="{rowPx}px">{#each header as part, i (i)}{#if i > 0}&nbsp;{/if}{#if 'reason' in part}<TextCell text="" reason={part.reason} />{:else}{part.text}{/if}{/each}</div>
  {#if series.length === 0}
    <div class="empty" style:color={role('textDim')}>{noDataYet}</div>
  {:else}
    <Chart {series} {bands} xLabel={text.xLabel} yLabel={text.yLabel} x={{ kind: 'lap' }} size={chartSize} yFormat={formatGapTick} />
  {/if}
</div>

<style>
  .gap {
    white-space: nowrap;
  }
  .ref {
    text-align: right;
  }
</style>
