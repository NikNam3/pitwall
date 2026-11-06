<script lang="ts">
  // The stint scatter (spec 6; approved mockup docs/design/2026-10-30-sp4a-displays/4-longrun.html, compounds table in
  // docs/design/2026-11-06-sp4.1a/source-badge.html): lap time over tyre age per stint on the kit chart, used laps as dots,
  // excluded ones as faint rings pinned at the edge, down-weighted ones as dotted rings, the fit with its band; full adds
  // the current stint's basis and the prior per compound with its source. The analysis computed every value (C65).
  import Chart from '../../kit/chart/Chart.svelte';
  import { TENTH_STEPS_MS } from '../../kit/chart/data.ts';
  import { fitCell } from '../../kit/grid/grid.ts';
  import { noDataYet, sourceWord } from '../../kit/text.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import { formatMinutesTenths } from '../../kit/values/format.ts';
  import { sourceTitle } from '../../kit/values/source-badge.ts';
  import SourceBadge from '../../kit/values/SourceBadge.svelte';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role, roleOrUndefined } from '../../theme/index.ts';
  import { chartOf, compoundRows, stintPlots } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** Column widths of the compounds table; the badge takes the cell after DEG/LAP. */
  const W = { cmp: 3, toSoft: 7, degPerLap: 7, sd: 5, source: 11 } as const;

  const full = $derived(size.mode === 'full');
  const value = $derived(data.analysis.known ? data.analysis.value : undefined);
  const current = $derived(value?.stints.at(-1));
  const plots = $derived(value ? stintPlots(value.stints, full ? 'full' : 'compact') : []);
  const chart = $derived(chartOf(plots));
  const rows = $derived(full && value ? compoundRows(value.compounds) : []);
  const header = $derived(
    [
      fitCell(text.compoundHeaders.cmp, W.cmp),
      fitCell(text.compoundHeaders.toSoft, W.toSoft, 'right'),
      fitCell(text.compoundHeaders.degPerLap, W.degPerLap, 'right'),
      ` ${fitCell(text.compoundHeaders.sd, W.sd, 'right')}`,
      fitCell(text.compoundHeaders.source, W.source),
    ].join(' '),
  );
  // Text lines above and below the chart (each one row): full shows the basis line, the header and one per compound.
  const textLines = $derived(full ? 1 + (rows.length > 0 ? 1 + rows.length : 0) : 0);
  const rowPx = $derived(size.px.height / size.rows);
  const chartSize = $derived({
    ...size,
    rows: Math.max(0, size.rows - textLines),
    px: { ...size.px, height: Math.max(0, Math.floor(size.px.height - textLines * rowPx)) },
  });
</script>

<div class="scatter">
  {#if !data.analysis.known}
    <div class="line"><TextCell text="" reason={data.analysis.reason} /></div>
  {:else if current === undefined}
    <div class="line" style:color={role('textDim')}>{noDataYet}</div>
  {:else}
    {#if full}
      <div class="line basis" style:color={role('textDim')}>{#if !current.fitLine.known}{text.fitUnknown} <TextCell
            text=""
            reason={current.fitLine.reason}
          /> {/if}{text.basis[current.basis]}</div>
    {/if}
    <Chart
      series={chart.series}
      marks={chart.marks}
      xLabel={full ? text.xLabel : text.noAxisLabel}
      yLabel={full ? text.yLabel(current.fuelCorrected) : text.noAxisLabel}
      x={{ kind: 'tyreAge' }}
      size={chartSize}
      yFormat={formatMinutesTenths}
      ySteps={TENTH_STEPS_MS}
    />
    {#if rows.length > 0}
      <div class="line faint">{header}</div>
      {#each rows as r, n (n)}
        <div class="line" style:color={roleOrUndefined(r.role)}><TextCell text={r.compound} width={W.cmp} /> <TextCell
            {...r.toSoft}
            width={W.toSoft}
            align="right"
          /> <TextCell {...r.degPerLap} width={W.degPerLap} align="right" /><span class="badge"><SourceBadge source={r.source} /></span> <TextCell
            {...r.sd}
            width={W.sd}
            align="right"
          /> <TextCell text={sourceWord[r.source.kind]} width={W.source} title={sourceTitle(r.source)} /></div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .scatter {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
  .basis {
    text-align: right;
  }
  .faint {
    color: var(--pw-textFaint);
  }
  /* The badge takes one cell, empty for a value measured this session, so the columns after it stay aligned. */
  .badge {
    display: inline-block;
    min-width: 1ch;
  }
</style>
