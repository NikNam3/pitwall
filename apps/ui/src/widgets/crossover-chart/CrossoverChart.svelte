<script lang="ts">
  // The crossover chart (SP4.1b spec 4, V19; mockup docs/design/2026-10-30-sp4a-displays/5-weather.html): US against the
  // dry reference, the payback with its loss source, the first faster car, then the field's median lap per tyre type
  // with the 110 % line and the dry reference. Compact shows the three numbers alone. Everything is the analysis's (C43).
  import Chart from '../../kit/chart/Chart.svelte';
  import { TENTH_STEPS_MS } from '../../kit/chart/data.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import SourceBadge from '../../kit/values/SourceBadge.svelte';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { formatMinutesTenths } from '../../kit/values/format.ts';
  import { typeRole } from './emphasis.ts';
  import { chartSeries, crossoverNumbers, isFirstFaster } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** Full shows two text lines above the chart, each one row; the chart gets the rest. */
  const TEXT_LINES = 2;

  const full = $derived(size.mode === 'full');
  const n = $derived(crossoverNumbers(data.crossover, data.cars));
  const ff = $derived(n.firstFaster);
  const series = $derived(full ? chartSeries(data.crossover) : []);
  const rowPx = $derived(size.px.height / size.rows);
  const chartSize = $derived({
    ...size,
    rows: Math.max(0, size.rows - TEXT_LINES),
    px: { ...size.px, height: Math.max(0, Math.floor(size.px.height - TEXT_LINES * rowPx)) },
  });
</script>

{#snippet usPart()}<span class="faint">{text.us}</span> <TextCell {...n.us} /> <span class="faint">{text.ofDryRef}</span> <TextCell
    {...n.dryRef}
  />{/snippet}
{#snippet paybackPart()}<span class="faint">{text.payback}</span> <span class="main"><TextCell {...n.payback} /></span>{#if n.paybackSource}<SourceBadge
      source={n.paybackSource}
    />{/if}{/snippet}

<div class="crossover">
  {#if full}
    <div class="line">{@render usPart()}   {@render paybackPart()}</div>
    <div class="line"><span class="faint">{text.firstFaster}</span> {#if isFirstFaster(ff)}<TextCell {...ff.code} /> <span class="faint"
          >{text.on}</span
        > <TextCell text={text.typeNames[ff.type]} role={typeRole(ff.type)} /> <span class="faint">{text.inSector}</span> {ff.sector} <span
          class="faint">{text.on}</span
        > {ff.lap}{:else}<TextCell {...ff} />{/if}</div>
    {#if series.length > 0}
      <Chart
        {series}
        xLabel={text.xLabel}
        yLabel={text.yLabel}
        x={{ kind: 'lap' }}
        size={chartSize}
        yFormat={formatMinutesTenths}
        ySteps={TENTH_STEPS_MS}
      />
    {/if}
  {:else}
    <div class="line">{@render usPart()}</div>
    <div class="line"><span class="faint">{text.firstFaster}</span> {#if isFirstFaster(ff)}<TextCell {...ff.code} /> <TextCell
          text={text.typeNames[ff.type]}
          role={typeRole(ff.type)}
        /> {ff.sector} {ff.lap}{:else}<TextCell {...ff} />{/if}</div>
    <div class="line">{@render paybackPart()}</div>
  {/if}
</div>

<style>
  .crossover {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
  .faint {
    color: var(--pw-textFaint);
  }
  .main {
    font-weight: var(--pw-weight-bold);
  }
</style>
