<script lang="ts">
  // Per corner tyre temperatures, pressure, brake and wear, plus the engine (spec 8.2, V22).
  import type { WidgetProps } from '../../kit/types.ts';
  import CornerGrid from '../../kit/corners/CornerGrid.svelte';
  import { fitCell } from '../../kit/grid/grid.ts';
  import { useStaleCarFields } from '../../kit/stale/panel-stale.ts';
  import { cornerNames } from '../../kit/text.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { CAR_FIELDS, compactBrake, cornerBlockRows, fullHeader, fullRowFields } from './rows.ts';
  import type { Cell } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const stale = useStaleCarFields(() => ({ updatedAt: data.car.updatedAt, fields: CAR_FIELDS }));
  const rows = $derived(cornerBlockRows(data.car, data.bands, data.wear, stale.isStale));
  const brake = $derived(compactBrake(rows));
  const full = $derived(size.mode === 'full');
  const order = ['fl', 'fr', 'rl', 'rr'] as const;
</script>

<!-- `shown` is the cell's text fitted to its column: an unknown keeps that width, its mark right-aligned like the numbers
     (an unfitted unknown, '', is the mark alone). -->
{#snippet value(c: Cell, shown: string)}<TextCell text={shown} reason={c.reason} role={c.role} width={shown.length || undefined} align="right" />{/snippet}

<div class="block">
  {#if full}
    <div class="line faint">{fullHeader()}</div>
    {#each order as name (name)}
      <div class="line">{#each fullRowFields(name, rows.corners[name]) as f, i (i)}{i === 0 ? '' : ' '}{#if f.cell}{@render value(f.cell, f.text)}{:else}{f.text}{/if}{/each}</div>
    {/each}
    <div class="line">&nbsp;</div>
    <div class="line">{text.labels.engine}  {@render value(rows.engine, rows.engine.text)}</div>
  {:else}
    <CornerGrid corners={rows.corners}>
      {#snippet cell(row, name)}<div class="line">{cornerNames[name]} {@render value(row.surface, fitCell(row.surface.compactText, 4, 'right'))} {@render value(row.wear, fitCell(row.wear.compactText, 3, 'right'))}</div>{/snippet}
    </CornerGrid>
    <div class="line">{text.labels.brake} {@render value(brake.cell, brake.text)}  {text.labels.engine} {@render value(rows.engine, rows.engine.compactText)}</div>
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
