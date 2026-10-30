<script lang="ts" generics="Row">
  // The dense table every display uses (spec 5): columns drop by priority, rows are banded, inactive rows sink.
  import type { Snippet } from 'svelte';
  import { DEFAULT_THEME, cssNumber, role } from '../../theme/index.ts';
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

  let host: HTMLDivElement | undefined = $state();
  // The tokens as the table sees them (a theme may be applied on an ancestor, as in the gallery's cells). The column
  // gap is read one way per use: code counts it in cells from `--pw-col-gap-cols` (as the chart does), CSS lays it out
  // with the length `--pw-col-gap`.
  const tokens = $derived(host ?? document.documentElement);
  const gapCols = $derived(cssNumber(tokens, '--pw-col-gap-cols', DEFAULT_THEME.density.columnGapCols));
  const boldWeight = $derived(cssNumber(tokens, '--pw-weight-bold', DEFAULT_THEME.table.boldWeight));
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

<div class="table" bind:this={host} style:font-family="var(--pw-font)" style:font-size="var(--pw-font-px)" style:line-height="var(--pw-line)">
  <div class="row head" style:grid-template-columns={template} style:column-gap="var(--pw-col-gap)">
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
      style:column-gap="var(--pw-col-gap)"
      style:font-weight={highlight !== undefined && rowKey(r) === highlight ? boldWeight : undefined}
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
    /* Inside the line box, so the header is exactly one line tall. */
    box-shadow: inset 0 calc(-1 * var(--pw-border-px)) 0 var(--pw-border);
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
    box-shadow: inset var(--pw-bar-px) 0 0 var(--pw-ownCar);
  }
</style>
