<script lang="ts">
  // The game's forecast of this session (spec 4; mockup docs/design/2026-10-30-sp4a-displays/5-weather.html). Full: one
  // column per sample (minutes, weather, rain, track and air with the game's trend), the first rain white bold, the
  // accuracy note on its own last row (R10). Compact: now and the first rain. The first rain is the topic's (C43).
  import type { WidgetProps } from '../../kit/types.ts';
  import { fitCell } from '../../kit/grid/grid.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role, roleOrUndefined } from '../../theme/index.ts';
  import { firstRainRole, labelRole, noteRole } from './emphasis.ts';
  import { accuracyNote, compactLines, fullColumns } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** The label column, with its leading space. */
  const LABEL_COLS = 7;
  /** A sample's column: right-aligned text; a temperature takes six and its trend mark the seventh. */
  const SAMPLE_COLS = 7;

  const full = $derived(size.mode === 'full');
  const columns = $derived(fullColumns(data.forecast, Math.floor((size.cols - LABEL_COLS) / SAMPLE_COLS)));
  const compact = $derived(compactLines(data.forecast));
  const note = $derived(accuracyNote(data.forecast.accuracy, full ? 'full' : 'compact'));
  const label = (l: string): string => fitCell(` ${l}`, LABEL_COLS);
  const cell = (t: string): string => fitCell(t, SAMPLE_COLS, 'right');
  const temp = (t: string, trend: string): string => fitCell(t, SAMPLE_COLS - 1, 'right') + fitCell(trend, 1);
  const mark = (firstRain: boolean): string | undefined => roleOrUndefined(firstRainRole(firstRain));
  const band = role('bgRowBand');
</script>

<div class="block">
  {#if full}
    <div class="line" style:color={role(labelRole)}>{label(text.rowLabels.offset)}{columns.map((c) => cell(c.offset)).join('')}</div>
    <div class="line"><span style:color={role(labelRole)}>{label(text.rowLabels.sky)}</span>{#each columns as c, i (i)}<span
          class:bold={c.firstRain}
          style:color={mark(c.firstRain)}>{cell(c.sky)}</span
        >{/each}</div>
    <div class="line" style:background-color={band}><span style:color={role(labelRole)}>{label(text.rowLabels.rain)}</span>{#each columns as c, i (i)}<span
          class:bold={c.firstRain}
          style:color={mark(c.firstRain)}>{cell(c.rain)}</span
        >{/each}</div>
    <div class="line"><span style:color={role(labelRole)}>{label(text.rowLabels.track)}</span>{columns.map((c) => temp(c.track, c.trackTrend)).join('')}</div>
    <div class="line" style:background-color={band}><span style:color={role(labelRole)}>{label(text.rowLabels.air)}</span>{columns.map((c) => temp(c.air, c.airTrend)).join('')}</div>
    {#if note !== ''}
      <div class="line" style:color={role(noteRole)}> {note}</div>
    {/if}
  {:else}
    {#if compact.now !== undefined}
      <div class="line"> <span style:color={role(labelRole)}>{text.compactLabels.now}</span> {compact.now.sky} {compact.now.rain}  <span
          style:color={role(labelRole)}>{text.compactLabels.track}</span
        > {compact.now.track} <span style:color={role(labelRole)}>{text.compactLabels.air}</span> {compact.now.air}</div>
    {/if}
    <div class="line"> <span style:color={role(labelRole)}>{text.compactLabels.rain}</span> <span
        class:bold={compact.firstRain.reason === undefined}
        ><TextCell {...compact.firstRain} role={firstRainRole(compact.firstRain.reason === undefined)} /></span
      >{#if note !== ''}{'  '}<span style:color={role(noteRole)}>{note}</span>{/if}</div>
  {/if}
</div>

<style>
  .block {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
  .bold {
    font-weight: bold;
  }
</style>
