<script lang="ts">
  // Per corner tyre temperatures, pressure, brake and wear, plus the engine (spec 8.2, V22).
  import type { WidgetProps } from '../../kit/types.ts';
  import CornerGrid from '../../kit/corners/CornerGrid.svelte';
  import { fitCell } from '../../kit/grid/grid.ts';
  import { unknownReason } from '../../kit/text.ts';
  import { roleOrUndefined } from '../../theme/index.ts';
  import { cornerBlockRows, FULL_COLUMNS, fullHeader, worstBrake } from './rows.ts';
  import type { Cell } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const rows = $derived(cornerBlockRows(data.car, data.bands, data.wear));
  const worst = $derived(worstBrake(rows));
  const full = $derived(size.mode === 'full');
  const order = ['fl', 'fr', 'rl', 'rr'] as const;
  const hint = (c: Cell): string | undefined => (c.reason === undefined ? undefined : unknownReason[c.reason]);
  const columns = ['surface', 'carcass', 'pressure', 'brake', 'wear'] as const;
  const field = (i: number, c: Cell): string => fitCell(c.text, FULL_COLUMNS[i + 1]?.width ?? 0, 'right');
</script>

{#snippet part(c: Cell, width: number, compact: boolean)}<span style:color={roleOrUndefined(c.role)} title={hint(c)}>{fitCell(compact ? c.compactText : c.text, width, 'right')}</span>{/snippet}

<div class="block">
  {#if full}
    <div class="line faint">{fullHeader()}</div>
    {#each order as name (name)}
      {@const row = rows.corners[name]}
      <div class="line">{fitCell(name.toUpperCase(), 2)}{#each columns as column, i (column)} <span style:color={roleOrUndefined(row[column].role)} title={hint(row[column])}>{field(i, row[column])}</span>{/each}</div>
    {/each}
    <div class="line">&nbsp;</div>
    <div class="line">{text.labels.engine}  <span style:color={roleOrUndefined(rows.engine.role)} title={hint(rows.engine)}>{rows.engine.text}</span></div>
  {:else}
    <CornerGrid corners={rows.corners}>
      {#snippet cell(row, name)}<div class="line">{name.toUpperCase()} {@render part(row.surface, 4, true)} {@render part(row.wear, 3, true)}</div>{/snippet}
    </CornerGrid>
    <div class="line">{text.labels.brake} {#if worst}<span style:color={roleOrUndefined(worst.cell.role)}>{worst.corner.toUpperCase()} {worst.cell.compactText}</span>{/if}  {text.labels.engine} <span style:color={roleOrUndefined(rows.engine.role)} title={hint(rows.engine)}>{rows.engine.compactText}</span></div>
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
