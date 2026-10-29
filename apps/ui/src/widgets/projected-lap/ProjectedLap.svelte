<script lang="ts">
  // The projected lap, the quali cut-off and the finish margin (spec 8.3, V10 + V11).
  import type { WidgetProps } from '../../kit/types.ts';
  import { fitCell } from '../../kit/grid/grid.ts';
  import { unknownReason } from '../../kit/text.ts';
  import { ourCars } from '../../kit/car/our-cars.ts';
  import { roleOrUndefined } from '../../theme/index.ts';
  import { PROJECTION_COLUMNS, projectionHeader, projectionRows } from './rows.ts';
  import type { ProjectionRow } from './rows.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const full = $derived(size.mode === 'full');
  const ours = $derived(ourCars(data.session).has(data.projection.carId));
  const rows = $derived(projectionRows(data.projection, ours).filter((r) => full || r.key === 'proj'));
  const header = $derived(projectionHeader(full));
  const cell = (row: ProjectionRow, key: 'name' | 'time' | 'pos' | 'delta' | 'label'): string => {
    const column = PROJECTION_COLUMNS.find((c) => c.key === key);
    return fitCell(row[key], column?.width ?? 0, column?.align);
  };
  const hint = (r: ProjectionRow): string | undefined => (r.reason === undefined ? undefined : unknownReason[r.reason]);
</script>

<div class="block">
  <div class="line faint">{header}</div>
  {#each rows as row (row.key)}
    <div class="line" title={hint(row)}>{cell(row, 'name')} {cell(row, 'time')} {cell(row, 'pos')} <span style:color={roleOrUndefined(row.deltaRole)}>{cell(row, 'delta')}</span>{#if full}{` ${cell(row, 'label')}`}{/if}</div>
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
