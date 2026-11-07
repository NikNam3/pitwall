<script lang="ts">
  // The gap chart (V04): each car's gap to a virtual car at the reference pace, per lap, then dotted to its gap now; with
  // the rejoin ghost (SP4.2 spec 4) the panel's car's ghost lines too, faint and lettered, and their losses in the header.
  import { carCodeById } from '../../kit/car/car-label.ts';
  import Chart from '../../kit/chart/Chart.svelte';
  import type { WidgetProps } from '../../kit/types.ts';
  import { ourCars } from '../../kit/car/our-cars.ts';
  import { noDataYet, separator } from '../../kit/text.ts';
  import CellParts from '../../kit/values/CellParts.svelte';
  import SourceBadge from '../../kit/values/SourceBadge.svelte';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { formatGapTick } from '../../kit/values/format.ts';
  import { role } from '../../theme/index.ts';
  import { gapSeries, ghostSeries, phaseBands } from './series.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const ours = $derived(ourCars(data.session));
  const field = $derived(gapSeries(data.gapper, data.cars, ours));
  const series = $derived([...field, ...ghostSeries(data.ghosts, data.rejoin?.carId)]);
  const bands = $derived(phaseBands(data.gapper.phases));
  const header = $derived(text.referenceText(data.gapper, (id) => carCodeById(data.cars, id)));
  const losses = $derived(text.ghostLosses(data.rejoin));
  // The compact header has room for one of the two: the losses when there are any, else the reference.
  const showReference = $derived(size.mode === 'full' || losses.length === 0);
  // The reference line takes one text row; the chart gets the rest.
  const rowPx = $derived(size.px.height / size.rows);
  const chartSize = $derived({ ...size, rows: size.rows - 1, px: { ...size.px, height: Math.max(0, size.px.height - rowPx) } });
</script>

<div class="gap">
  <!-- The parts of the line, a space apart; an unknown part (the lap time, or the reference car's code) shows its mark there. -->
  <div class="ref" style:color={role('textDim')} style:height="{rowPx}px">
    {#if showReference}<CellParts parts={header} separator=" " />{/if}{#if showReference && losses.length > 0}{separator}{/if}{#if losses.length > 0}{text.pit}{#each losses as l (l.condition)}
        {l.letter} <TextCell {...l.loss} /><SourceBadge source={l.source} />{/each}{/if}
  </div>
  {#if field.length === 0}
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
