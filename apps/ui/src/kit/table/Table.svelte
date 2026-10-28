<script lang="ts" generics="Row">
  // The dense table every display uses (spec 5): columns drop by priority, rows are banded, inactive rows sink.
  import type { Snippet } from 'svelte';
  import { cssVar, role } from '../../theme/index.ts';
  import { fitColumns } from '../size/size.ts';
  import type { WidgetSize } from '../types.ts';

  type Column = {
    key: string;
    label: string;
    widthCols: number;
    /** 1 is the most important; the highest number drops first. */
    priority: number;
    align?: 'left' | 'right' | undefined;
    cell: Snippet<[Row]>;
  };
  type Props = {
    columns: Column[];
    rows: Row[];
    rowKey: (r: Row) => string;
    inactive?: ((r: Row) => boolean) | undefined;
    size: WidgetSize;
    /** The key of the row to mark. */
    highlight?: string | undefined;
  };
  let { columns, rows, rowKey, inactive, size, highlight }: Props = $props();

  // The gap is the density token `--pw-col-gap` (a length in ch), counted in cells; applyTheme always sets it, 0 only without a theme.
  const gapCols = $derived.by(() => {
    const v = parseFloat(cssVar(document.documentElement, '--pw-col-gap'));
    return Number.isFinite(v) ? v : 0;
  });
  const shown = $derived.by(() => {
    const keep = new Set(fitColumns(columns, size.cols, gapCols));
    return columns.filter((c) => keep.has(c.key));
  });
  const ordered = $derived.by(() => {
    const isOut = inactive ?? (() => false);
    return [...rows.filter((r) => !isOut(r)), ...rows.filter((r) => isOut(r))];
  });
  const template = $derived(shown.map((c) => `${c.widthCols}ch`).join(' '));
</script>

<div class="table" style:font-family="var(--pw-font)" style:font-size="var(--pw-font-px)" style:line-height="var(--pw-line)">
  <div class="row head" style:grid-template-columns={template} style:column-gap="{gapCols}ch">
    {#each shown as c (c.key)}
      <div class="cell" class:right={c.align === 'right'} data-col={c.key}>{c.label}</div>
    {/each}
  </div>
  {#each ordered as r, i (rowKey(r))}
    <div
      class="row"
      class:inactive={inactive?.(r) === true}
      class:highlight={highlight !== undefined && rowKey(r) === highlight}
      data-row={rowKey(r)}
      style:grid-template-columns={template}
      style:column-gap="{gapCols}ch"
      style:background-color={i % 2 === 1 ? role('bgRowBand') : undefined}
    >
      {#each shown as c (c.key)}
        <div class="cell" class:right={c.align === 'right'} data-col={c.key}>{@render c.cell(r)}</div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .table {
    color: var(--pw-text);
    white-space: nowrap;
  }
  .row {
    display: grid;
  }
  .head {
    color: var(--pw-textDim);
    border-bottom: 1px solid var(--pw-border);
  }
  .cell {
    overflow: hidden;
    text-overflow: clip;
  }
  .right {
    text-align: right;
  }
  .inactive {
    color: var(--pw-textFaint);
  }
  .highlight {
    color: var(--pw-ownCar);
    box-shadow: inset 2px 0 0 var(--pw-ownCar);
  }
</style>
