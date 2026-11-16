<script lang="ts">
  // The Box call (SP4.3d spec §6.3; mockup docs/design/2026-11-16-sp4.3d/sc-card.html): per condition block the six
  // answers stay, box S, M, H, I, W with E[pos] and its SE, ΔPOS against stay, P(gain), the rejoin position and the
  // position distribution on the block's one scale; compact, per condition the box option with the highest ΔPOS. The
  // condition that is out comes from the race's session phase through the presentation table (C66); the display maps
  // and formats, it computes nothing (C65).
  import DistStrip from '../../kit/dist/DistStrip.svelte';
  import { placesHeader } from '../../kit/dist/places.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role, roleOrUndefined } from '../../theme/index.ts';
  import { bestRole, headerRole, noSetRole, outRole } from './emphasis.ts';
  import { activeCondition } from './presentation.ts';
  import { buildBlocks, buildCompact, isDrawn, type BlockView, type CompactRow, type OptionRow } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** The lead cell before the first column. */
  const LEAD = ' ';
  /** The cell between two columns. */
  const GAP = ' ';
  /** Column widths (the mockup's). */
  const LABEL = 6;
  const OPTION = 6;
  const EPOS = 9;
  const DPOS = 6;
  const PGAIN = 7;
  const REJ = 4;

  const full = $derived(size.mode === 'full');
  const out = $derived(activeCondition(data.phase));
  const blocks = $derived(full ? buildBlocks(data.call.value, out) : []);
  const compact = $derived(full ? [] : buildCompact(data.call.value, out));
  const none = $derived(data.call.value.blocks.length === 0);
</script>

{#snippet label(name: string, isOut: boolean)}<TextCell text={name} width={LABEL} role={isOut ? outRole() : undefined} />{/snippet}

{#snippet header(b: BlockView)}{LEAD}{@render label(b.label, b.out)}{GAP}<TextCell
    text={text.headers.ePos}
    width={EPOS}
    align="right"
  />{GAP}<TextCell text={text.headers.dPos} width={DPOS} align="right" />{GAP}<TextCell
    text={text.headers.pGain}
    width={PGAIN}
    align="right"
  />{GAP}<TextCell text={text.headers.rejoin} width={REJ} align="right" />{GAP}<TextCell
    text={placesHeader(b.places)}
  />{/snippet}

{#snippet cells(b: BlockView, r: OptionRow)}{LEAD}<TextCell text={r.label} width={LABEL} />{GAP}<TextCell
    {...r.ePos}
    width={EPOS}
    align="right"
  />{GAP}<TextCell {...r.dPos} width={DPOS} align="right" role={r.dPosRole} />{GAP}<TextCell
    {...r.pGain}
    width={PGAIN}
    align="right"
  />{GAP}<TextCell {...r.rejoin} width={REJ} align="right" />{GAP}{#if isDrawn(r.strip)}<DistStrip
      form="places"
      pmf={r.strip.pmf}
      scale={b.scale}
      ourPlace={b.ourPlace}
      lit={r.best}
    />{:else}<TextCell {...r.strip} width={b.places} />{/if}{/snippet}

<!-- Compact: the option follows the label's column directly (the mockup's); a label that fills it (`VSC ~2`) keeps a gap. -->
{#snippet compactCells(r: CompactRow)}{LEAD}{@render label(r.label, r.out)}{#if [...r.label].length >= LABEL}{GAP}{/if}<TextCell
    text={r.option}
    width={OPTION}
  />{GAP}<TextCell {...r.dPos} width={DPOS} align="right" />{GAP}<TextCell
    {...r.rejoin}
    width={REJ}
    align="right"
  />{/snippet}

<div class="block">
  {#if none}
    <div class="line"><TextCell text="" reason="notApplicable" /></div>
  {:else if full}
    {#each blocks as b, i (b.condition)}
      {#if i > 0}<div class="line"></div>{/if}
      <div class="line" style:color={role(headerRole)}>{@render header(b)}</div>
      {#each b.rows as r (r.answer)}
        <div
          class="line"
          style:color={roleOrUndefined(r.noSet ? noSetRole() : bestRole(r.best))}
        >{#if r.best}<strong>{@render cells(b, r)}</strong>{:else}{@render cells(b, r)}{/if}</div>
      {/each}
    {/each}
  {:else}
    {#each compact as r (r.condition)}
      <div class="line" style:color={roleOrUndefined(bestRole(r.lit))}>{#if r.lit}<strong
          >{@render compactCells(r)}</strong
        >{:else}{@render compactCells(r)}{/if}</div>
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
</style>
