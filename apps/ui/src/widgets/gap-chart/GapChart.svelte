<script lang="ts">
  // The gap chart (V04): each car's gap to a virtual car at the reference pace, per lap, then dotted to its gap now.
  import { carCodeById } from '../../kit/car/car-label.ts';
  import Chart from '../../kit/chart/Chart.svelte';
  import type { WidgetProps } from '../../kit/types.ts';
  import { ourCars } from '../../kit/car/our-cars.ts';
  import { noDataYet } from '../../kit/text.ts';
  import UnknownMark from '../../kit/values/UnknownMark.svelte';
  import { formatGapTick } from '../../kit/values/format.ts';
  import { role } from '../../theme/index.ts';
  import { gapSeries, phaseBands } from './series.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const ours = $derived(ourCars(data.session));
  const series = $derived(gapSeries(data.gapper, data.cars, ours));
  const bands = $derived(phaseBands(data.phases));
  const header = $derived(text.referenceText(data.gapper, (id) => carCodeById(data.cars, id)));
  // The reference line takes one text row; the chart gets the rest.
  const rowPx = $derived(size.px.height / size.rows);
  const chartSize = $derived({ ...size, rows: size.rows - 1, px: { ...size.px, height: Math.max(0, size.px.height - rowPx) } });
</script>

<div class="gap">
  <!-- The unknown part of the line (the lap time, or the reference car's code) shows as one mark at its end. -->
  <div class="ref" style:color={role('textDim')} style:height="{rowPx}px">{header.text}{#if header.reason}&nbsp;<UnknownMark reason={header.reason} />{/if}</div>
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
