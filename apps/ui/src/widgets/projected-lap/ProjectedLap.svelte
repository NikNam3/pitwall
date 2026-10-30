<script lang="ts">
  // The projected lap, the quali cut-off and the finish margin (spec 8.3, V10 + V11).
  import type { WidgetProps } from '../../kit/types.ts';
  import { fitCell } from '../../kit/grid/grid.ts';
  import UnknownMark from '../../kit/values/UnknownMark.svelte';
  import { ourCars } from '../../kit/car/our-cars.ts';
  import { roleOrUndefined } from '../../theme/index.ts';
  import { PROJECTION_COLUMNS, projectionHeader, projectionRows } from './rows.ts';
  import type { ProjectionRow, ValueColumn } from './rows.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const full = $derived(size.mode === 'full');
  const ours = $derived(ourCars(data.session).has(data.projection.carId));
  const rows = $derived(projectionRows(data.projection, ours).filter((r) => full || r.key === 'proj'));
  const header = $derived(projectionHeader(full));
  type Column = (typeof PROJECTION_COLUMNS)[number];
  const columnOf = (key: Column['key']): Column | undefined => PROJECTION_COLUMNS.find((c) => c.key === key);
  const cell = (row: ProjectionRow, key: Column['key']): string => fitCell(row[key], columnOf(key)?.width ?? 0, columnOf(key)?.align);
</script>

<!-- A hidden value shows its own reason's mark in its cell, as wide as the column. -->
{#snippet value(row: ProjectionRow, key: ValueColumn)}{@const reason = row.unknown?.[key]}{#if reason}<UnknownMark {reason} cols={columnOf(key)?.width} align="right" />{:else}{cell(row, key)}{/if}{/snippet}

<div class="block">
  <div class="line faint">{header}</div>
  {#each rows as row (row.key)}
    <div class="line">{cell(row, 'name')} {@render value(row, 'time')} {@render value(row, 'pos')} <span style:color={roleOrUndefined(row.deltaRole)}>{@render value(row, 'delta')}</span>{#if full}{` ${cell(row, 'label')}`}{/if}</div>
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
