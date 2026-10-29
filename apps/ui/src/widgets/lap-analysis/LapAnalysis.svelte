<script lang="ts">
  // Every car's best lap and sectors as deltas to the reference car, which shows absolute times (spec 8.3, V28).
  import type { WidgetProps } from '../../kit/types.ts';
  import { fitCell } from '../../kit/grid/grid.ts';
  import { fitColumns } from '../../kit/size/size.ts';
  import { unknownReason } from '../../kit/text.ts';
  import { ourCarRole } from '../../emphasis/index.ts';
  import { roleOrUndefined } from '../../theme/index.ts';
  import { LAP_COLUMNS, formatCell } from './columns.ts';
  import type { LapColumnKey } from './columns.ts';
  import { cellRole } from './emphasis.ts';
  import { buildRows } from './rows.ts';
  import type { Cell } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  // The reference car and the fastest rivals that fit under the header line.
  const rows = $derived(buildRows({ board: data.board, cars: data.cars, session: data.session }).slice(0, Math.max(1, size.rows - 1)));
  const kept = $derived(fitColumns(LAP_COLUMNS, size.cols, 1));
  const columns = $derived(LAP_COLUMNS.filter((c) => kept.includes(c.key)));
  const hint = (c: Cell): string | undefined => (c.value.known ? undefined : unknownReason[c.value.reason]);
  const sectorOf = (r: (typeof rows)[number], key: LapColumnKey): Cell | undefined =>
    key === 'best' ? r.best : key === 'theo' ? r.theo : key === 's1' ? r.sectors[0] : key === 's2' ? r.sectors[1] : key === 's3' ? r.sectors[2] : undefined;
</script>

<div class="block">
  <div class="line faint">{columns.map((c) => fitCell(text.headers[c.key], c.widthCols, c.align)).join(' ')}</div>
  {#each rows as r (r.carId)}
    <div class="line" class:ref={r.reference}>{#each columns as c, i (c.key)}{i === 0 ? '' : ' '}{#if c.key === 'drv'}<span style:color={roleOrUndefined(ourCarRole(r.ours))} title={r.code.reason === undefined ? undefined : unknownReason[r.code.reason]}>{fitCell(r.code.text, c.widthCols, c.align)}</span>{:else}{@const cell = sectorOf(r, c.key)}{#if cell}<span style:color={roleOrUndefined(cellRole(cell.status, r.ours))} title={hint(cell)}>{fitCell(formatCell(c.key, cell), c.widthCols, c.align)}</span>{/if}{/if}{/each}</div>
  {/each}
</div>

<style>
  .block {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
  .ref {
    font-weight: bold;
  }
  .faint {
    color: var(--pw-textFaint);
  }
</style>
