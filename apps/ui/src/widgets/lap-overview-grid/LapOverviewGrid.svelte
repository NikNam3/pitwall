<script lang="ts">
  // Every lap of a car as one block (spec 4, V09; mockups docs/design/2026-10-30-sp4a-displays/4-longrun.html and
  // docs/design/2026-11-06-sp4.1b/changes.html): full, ten laps to a row with the heat as background and a status strip;
  // compact, one block per lap with its height by the heat. Heat, best and status are the analysis's (C43).
  import type { WidgetProps } from '../../kit/types.ts';
  import { fitCell } from '../../kit/grid/grid.ts';
  import { noDataYet } from '../../kit/text.ts';
  import { role, roleOrUndefined } from '../../theme/index.ts';
  import { heatBackground, lapRole, statusRole } from './emphasis.ts';
  import { compactLine, gridLines } from './rows.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** Width of a lap time; the strip text under it spans the time and its mark. */
  const TIME_COLS = 6;
  const STRIP_COLS = TIME_COLS + 1;
  /** The full line's lead: a space and the row label `L01`. */
  const LABEL_COLS = 4;

  const full = $derived(size.mode === 'full');
  const empty = $derived(data.overview.laps.length === 0);
  const lines = $derived(full ? gridLines(data.overview.laps, size.rows) : []);
  const compact = $derived(full ? undefined : compactLine(data.overview.laps, size.cols));
</script>

<div class="block">
  {#if empty}
    <div class="line" style:color={role('textDim')}>{noDataYet}</div>
  {:else if compact}
    <div class="line faint"> {compact.label}</div>
    <div class="line"> {#each compact.cells as c (c.lapNumber)}<span style:color={roleOrUndefined(lapRole(c))}>{c.block}</span>{/each}</div>
    <div class="line"> {#each compact.cells as c (c.lapNumber)}<span style:color={roleOrUndefined(statusRole(c.status))}>{fitCell(c.strip, 1)}</span>{/each}</div>
  {:else}
    {#each lines as l, n (n)}
      {#if l.kind === 'stint'}
        <div class="line faint"> {l.text}</div>
      {:else if l.kind === 'laps'}
        <div class="line"><span class="faint"> {l.label}</span>{#each l.cells as c (c.lapNumber)}{' '}<span
              style:color={roleOrUndefined(lapRole(c))}
              style:background={heatBackground(c.heat)}>{fitCell(c.time, TIME_COLS, 'right')}</span><span class="faint">{fitCell(c.mark, 1)}</span>{/each}</div>
      {:else}
        <div class="line">{fitCell('', LABEL_COLS)}{#each l.cells as c (c.lapNumber)}{' '}<span style:color={roleOrUndefined(statusRole(c.status))}
              >{fitCell(c.strip, STRIP_COLS)}</span
            >{/each}</div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .block {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
  .faint {
    color: var(--pw-textFaint);
  }
</style>
