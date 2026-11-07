<script lang="ts">
  // The SC / VSC call (SP4.2 spec 4; mockup docs/design/2026-11-07-sp4.2/sc-card.html): per condition our rejoin position,
  // the stop's loss and the gain against a green stop, each value badged with the loss's source. The condition that is
  // out comes from the race's session phase through the presentation table (C66); the display maps, it computes nothing.
  import type { EstimateSource } from '@pitwall/domain';
  import type { WidgetProps } from '../../kit/types.ts';
  import { fitCell, type CellPart } from '../../kit/grid/grid.ts';
  import SourceBadge from '../../kit/values/SourceBadge.svelte';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role, roleOrUndefined } from '../../theme/index.ts';
  import { rowRole, stateRole } from './emphasis.ts';
  import { activeCondition } from './presentation.ts';
  import { buildRows, type ScRow } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** The lead cell before the first column. */
  const LEAD = ' ';
  /** The cells between two columns. */
  const GAP = '  ';
  /** Column widths: a value column is its value in VALUE cells plus one badge cell. */
  const COND = 3;
  const REJOIN_FULL = 6;
  const REJOIN_COMPACT = 3;
  const VALUE = 5;
  const BADGED = VALUE + 1;
  /** The badge cell kept blank: a value measured this session, or an unknown one. */
  const NO_BADGE = ' ';

  const full = $derived(size.mode === 'full');
  const active = $derived(activeCondition(data.phase));
  const rows = $derived(buildRows(data.call, active));
</script>

{#snippet badged(part: CellPart, source: EstimateSource)}<TextCell {...part} width={VALUE} align="right" />{#if part.reason === undefined && source.kind !== 'session'}<SourceBadge
      {source}
    />{:else}{NO_BADGE}{/if}{/snippet}

{#snippet cells(r: ScRow)}{LEAD}<TextCell text={text.conditions[r.condition]} width={COND} />{GAP}<TextCell
    {...r.rejoin}
    width={full ? REJOIN_FULL : REJOIN_COMPACT}
    align="right"
  />{#if full}{GAP}{@render badged(r.loss, r.source)}{/if}{GAP}{@render badged(r.gain, r.source)}{/snippet}

<div class="block">
  {#if full}
    <div class="line faint">{LEAD}<TextCell
        text={active === undefined ? '' : text.conditions[active]}
        width={COND}
        role={active === undefined ? undefined : stateRole()}
      />{GAP}{fitCell(text.headers.rejoin, REJOIN_FULL, 'right')}{GAP}{fitCell(text.headers.loss, BADGED, 'right')}{GAP}{fitCell(
        text.headers.gain,
        BADGED,
        'right',
      )}</div>
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
