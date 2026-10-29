<script lang="ts">
  // One row per neighbour of the linked car (V14): gap, closing rate, laps to DRS, pace, margin, tyres, rival ERS.
  import CompoundMark from '../../kit/compound/CompoundMark.svelte';
  import { fitCell } from '../../kit/grid/grid.ts';
  import { unknownReason } from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import { battleHeader, battleRows, columnsFor, type ColumnId } from './rows.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const mode = $derived(size.mode);
  const columns = $derived(columnsFor(mode));
  const rows = $derived(battleRows(data.card, data.cars, data.moment));
  const WIDTH: Record<ColumnId, [number, 'left' | 'right']> = {
    drv: [3, 'right'], gap: [6, 'right'], closing: [10, 'right'], toDrs: [8, 'right'],
    paceDelta: [6, 'right'], margin: [6, 'right'], tyres: [7, 'left'], ers: [6, 'right'],
  };
  const sp = ' ';
  const pad = (t: string): string => ' '.repeat(Math.max(0, 7 - t.length));
  const cell = (c: ColumnId, t: string): string => fitCell(t, WIDTH[c][0], WIDTH[c][1]);
</script>

<div class="battle"><span class="head">{battleHeader(mode)}</span>{#each rows as row (row.label)}<span class="row" class:hi={row.highlighted} data-testid="battle-{row.label}">{row.label.padEnd(6)}{#each columns as c (c)}{sp}{#if c === 'tyres' && row.tyres}<CompoundMark compound={row.tyres.ours.compound} age={row.tyres.ours.age} />{sp}<CompoundMark compound={row.tyres.theirs.compound} age={row.tyres.theirs.age} />{pad(row.cells.tyres.text)}{:else}<span
          class:strong={row.cells[c].role === 'text'}
          style:color={row.cells[c].role === undefined ? undefined : role(row.cells[c].role)}
          title={row.cells[c].reason === undefined ? undefined : unknownReason[row.cells[c].reason]}>{cell(c, row.cells[c].text)}</span
        >{/if}{/each}</span>{/each}</div>

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
  .strong {
    font-weight: bold;
  }
</style>
