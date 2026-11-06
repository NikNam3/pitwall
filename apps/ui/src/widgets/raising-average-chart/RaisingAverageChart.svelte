<script lang="ts">
  // The raising average (spec 4; approved mockup docs/design/2026-11-06-sp4.1b/changes.html, part a): per car the mean of
  // its best X laps over X on the kit chart; our cars always, the rivals the options name. The analysis computed every
  // value (C65).
  import { ourCars } from '../../kit/car/our-cars.ts';
  import Chart from '../../kit/chart/Chart.svelte';
  import { TENTH_STEPS_MS } from '../../kit/chart/data.ts';
  import { noDataYet } from '../../kit/text.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import { formatMinutesTenths } from '../../kit/values/format.ts';
  import { role } from '../../theme/index.ts';
  import { axisLabels, raisingSeries } from './rows.ts';
  import type { widget } from './widget.ts';

  let { data, options, size }: WidgetProps<typeof widget> = $props();

  const series = $derived(raisingSeries(data.analysis, data.cars, ourCars(data.session), [options.rival1, options.rival2, options.rival3]));
  const labels = $derived(axisLabels(size.mode === 'full' ? 'full' : 'compact'));
</script>

<div class="raising">
  {#if series.length === 0}
    <div class="line" style:color={role('textDim')}>{noDataYet}</div>
  {:else}
    <!-- The x axis counts laps from 1 to the longest curve: the tyre-age kind shows the whole range whatever the width. -->
    <Chart {series} xLabel={labels.x} yLabel={labels.y} x={{ kind: 'tyreAge' }} {size} yFormat={formatMinutesTenths} ySteps={TENTH_STEPS_MS} />
  {/if}
</div>

<style>
  .raising {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
</style>
