<script lang="ts">
  // One row per neighbour of the linked car (V14): gap, pace, pass/hold margin, laps to DRS, tyres, rival ERS.
  import CompoundMark from '../../kit/compound/CompoundMark.svelte';
  import TextCell from '../../kit/values/TextCell.svelte';
  import type { WidgetProps } from '../../kit/types.ts';
  import { battleHeader, battleRows, columnsFor, LABEL_WIDTH, WIDTH, type Cell, type ColumnId } from './rows.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const mode = $derived(size.mode);
  const columns = $derived(columnsFor(mode));
  const rows = $derived(battleRows(data.card, data.cars, data.moment));
  const sp = ' ';
  const pad = (t: string): string => ' '.repeat(Math.max(0, WIDTH.tyres.width - t.length));
</script>

{#snippet field(cell: Cell, c: ColumnId)}<TextCell {...cell} width={WIDTH[c].width} align={WIDTH[c].align} />{/snippet}

<div class="battle"><span class="head">{battleHeader(mode)}</span>{#each rows as row (row.label)}<span class="row" class:hi={row.highlighted} data-testid="battle-{row.label}">{row.label.padEnd(LABEL_WIDTH)}{#each columns as c (c)}{sp}{#if c === 'tyres' && row.tyres}<CompoundMark compound={row.tyres.ours.compound} age={row.tyres.ours.age} />{sp}<CompoundMark compound={row.tyres.theirs.compound} age={row.tyres.theirs.age} />{pad(row.cells.tyres.text)}{:else if row.cells[c].reason === undefined && (row.cells[c].role === 'text' || row.cells[c].role === 'warning')}<strong>{@render field(row.cells[c], c)}</strong>{:else}{@render field(row.cells[c], c)}{/if}{/each}</span>{/each}</div>

<style>
  .battle {
    white-space: pre;
  }
  .head,
  .row {
    display: block;
  }
  .head {
    color: var(--pw-textFaint);
  }
  strong {
    font-weight: bold;
  }
</style>
