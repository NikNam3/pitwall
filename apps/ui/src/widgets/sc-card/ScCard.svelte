<script lang="ts">
  // The SC / VSC call (SP4.3b spec §10, V18; mockup docs/design/2026-11-12-sp4.3b/sc-card.html; Q5 B): per condition the
  // Monte Carlo's places gained by a stop now, its chance of a gain and its places-gained strip on one shared scale, our
  // rejoin position, the stop's loss badged with its source, and the trigger range. The condition that is out comes from
  // the race's session phase through the presentation table (C66); the display maps, it computes nothing (C65).
  import { SC_CALL_GAIN_BINS, type EstimateSource } from '@pitwall/domain';
  import type { WidgetProps } from '../../kit/types.ts';
  import DistStrip from '../../kit/dist/DistStrip.svelte';
  import { fitCell, type CellPart } from '../../kit/grid/grid.ts';
  import SourceBadge from '../../kit/values/SourceBadge.svelte';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role, roleOrUndefined } from '../../theme/index.ts';
  import { rowRole, stateRole } from './emphasis.ts';
  import { activeCondition } from './presentation.ts';
  import { buildRows, isDrawn, scaleOf, type ScRow } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** The lead cell before the first column. */
  const LEAD = ' ';
  /** The cell between two columns. */
  const GAP = ' ';
  /** Column widths (the mockup's). */
  const COND = 3;
  const DPOS = 4;
  const PGAIN_FULL = 7;
  const PGAIN_COMPACT = 4;
  const REJ = 3;
  const LOSS = 5;
  const RANGE = 6;
  /** The strip: one cell per bin (−4 … +4); zero is the fifth bin, its tick under the bin's centre. */
  const STRIP = SC_CALL_GAIN_BINS.count;
  const ZERO_BIN = 4;
  /** A known loss: its value in LOSS − 1 cells, then the badge cell, blank for a session value. */
  const LOSS_VALUE = LOSS - 1;
  const NO_BADGE = ' ';
  /** The strip's header: −4 over its first bin, 0 over the zero bin, +4 ending over its last. */
  const STRIP_HEADER =
    fitCell(text.stripLabels.low, ZERO_BIN) +
    fitCell(text.stripLabels.zero, STRIP - ZERO_BIN - text.stripLabels.high.length) +
    text.stripLabels.high;

  const full = $derived(size.mode === 'full');
  const active = $derived(activeCondition(data.phase));
  const rows = $derived(buildRows(data.call.value, active));
  const scale = $derived(scaleOf(rows));
</script>

{#snippet loss(part: CellPart, source: EstimateSource)}{#if part.reason === undefined}<TextCell
      {...part}
      width={LOSS_VALUE}
      align="right"
    />{#if source.kind !== 'session'}<SourceBadge {source} />{:else}{NO_BADGE}{/if}{:else}<TextCell
      {...part}
      width={LOSS}
      align="right"
    />{/if}{/snippet}

{#snippet strip(r: ScRow)}{#if isDrawn(r.strip)}<DistStrip
      form="gain"
      bins={r.strip.bins}
      {scale}
      zero={{ underBin: ZERO_BIN }}
      lit={r.active}
    />{:else}<TextCell {...r.strip} width={STRIP} />{/if}{/snippet}

{#snippet cells(r: ScRow)}{LEAD}<TextCell text={text.conditions[r.condition]} width={COND} />{GAP}<TextCell
    {...r.dPos}
    width={DPOS}
    align="right"
  />{GAP}<TextCell {...r.pGain} width={full ? PGAIN_FULL : PGAIN_COMPACT} align="right" />{#if full}{GAP}{@render strip(
      r,
    )}{/if}{GAP}<TextCell {...r.rejoin} width={REJ} align="right" />{#if full}{GAP}{@render loss(
      r.loss,
      r.source,
    )}{GAP}<TextCell {...r.range} width={RANGE} align="right" />{/if}{/snippet}

<div class="block">
  {#if full}
    <div class="line faint">{LEAD}<TextCell
        text={active === undefined ? '' : text.conditions[active]}
        width={COND}
        role={active === undefined ? undefined : stateRole()}
      />{GAP}{fitCell(text.headers.dPos, DPOS, 'right')}{GAP}{fitCell(
        text.headers.pGain,
        PGAIN_FULL,
        'right',
      )}{GAP}{STRIP_HEADER}{GAP}{fitCell(text.headers.rejoin, REJ, 'right')}{GAP}{fitCell(
        text.headers.loss,
        LOSS,
        'right',
      )}{GAP}{fitCell(text.headers.range, RANGE, 'right')}</div>
  {/if}
  {#each rows as r, i (r.condition)}
    <div
      class="line"
      style:color={roleOrUndefined(rowRole(r.active))}
      style:background-color={full && i % 2 === 1 && !r.active ? role('bgRowBand') : undefined}
    >{#if r.active}<strong>{@render cells(r)}</strong>{:else}{@render cells(r)}{/if}</div>
  {/each}
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
