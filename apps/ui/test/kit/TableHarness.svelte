<script lang="ts">
  // Test-only parent of the table: four columns whose `cell` snippets render one field each.
  import Table from '../../src/kit/table/Table.svelte';
  import type { WidgetSize } from '../../src/kit/types.ts';

  type Row = { id: string; name: string; gap: string; tyre: string; notes: string; out?: boolean };
  type Props = { rows: Row[]; size: WidgetSize; highlight?: string; widths?: [number, number, number, number] };
  let { rows, size, highlight, widths = [10, 8, 8, 6] }: Props = $props();

  const columns = $derived([
    { key: 'name', label: 'Driver', widthCols: widths[0], priority: 1, cell: nameCell },
    { key: 'gap', label: 'Gap', widthCols: widths[1], priority: 2, align: 'right' as const, cell: gapCell },
    { key: 'tyre', label: 'Tyre', widthCols: widths[2], priority: 3, cell: tyreCell },
    { key: 'notes', label: 'Notes', widthCols: widths[3], priority: 4, cell: notesCell },
  ]);
</script>

{#snippet nameCell(r: Row)}{r.name}{/snippet}
{#snippet gapCell(r: Row)}{r.gap}{/snippet}
{#snippet tyreCell(r: Row)}{r.tyre}{/snippet}
{#snippet notesCell(r: Row)}{r.notes}{/snippet}

<Table {columns} {rows} rowKey={(r: Row) => r.id} inactive={(r: Row) => r.out === true} {size} {highlight} />
