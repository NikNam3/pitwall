<script lang="ts">
  // The gap chart (V04): each car's gap to a virtual car at the reference pace, per lap.
  import { carId } from '@pitwall/domain';
  import { carCode } from '../../kit/car/car-code.ts';
  import Chart from '../../kit/chart/Chart.svelte';
  import type { WidgetProps } from '../../kit/types.ts';
  import { noDataYet } from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';
  import { gapperReference, gapSeries, ownCarIds, phaseBands } from './series.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, options, size }: WidgetProps<typeof widget> = $props();

  const ours = $derived(ownCarIds(data.session));
  const series = $derived(gapSeries(data.gapper, data.cars, ours));
  const bands = $derived(phaseBands(data.phases));
  const reference = $derived(gapperReference(options, data.session?.playerCar ?? carId(0)));
  const codeOf = (id: number): string => {
    const car = data.cars.find((c) => c.id === id);
    return car ? carCode(car.identity) : `#${id}`;
  };
  const header = $derived(text.referenceText(reference, data.gapper.referenceLapMs, codeOf));
  // The reference line takes one text row; the chart gets the rest.
  const rowPx = $derived(size.px.height / size.rows);
  const chartSize = $derived({ ...size, rows: size.rows - 1, px: { ...size.px, height: Math.max(0, size.px.height - rowPx) } });
</script>

<div class="gap">
  <div class="ref" style:color={role('textDim')} style:height="{rowPx}px">{header}</div>
  {#if series.length === 0}
    <div class="empty" style:color={role('textDim')}>{noDataYet}</div>
  {:else}
    <Chart {series} {bands} xLabel={text.xLabel} yLabel={text.yLabel} x={{ kind: 'lap' }} size={chartSize} yFormat={text.gapTick} />
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
