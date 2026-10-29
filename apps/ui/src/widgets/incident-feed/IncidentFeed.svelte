<script lang="ts">
  // One line per incident, newest first (V35): minor entries dim, the entry the incident moment names amber.
  import { roleOrUndefined } from '../../theme/index.ts';
  import { COLUMN_GAP, fitRow, incidentRows, LEAD } from './rows.ts';
  import type { widget } from './widget.ts';
  import type { WidgetProps } from '../../kit/types.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  // Newest first: what does not fit the panel's rows is the oldest and is cut.
  const rows = $derived(incidentRows(data.feed, data.cars, data.moment).slice(0, size.rows));
  const gap = ' '.repeat(COLUMN_GAP);
  const lead = ' '.repeat(LEAD);
</script>

<div class="feed">
  {#each rows as row (row.id)}
    <div class="row" style:color={roleOrUndefined(row.role)} data-testid="incident-{row.id}">{lead}{#each fitRow(size.mode, row, size.cols) as cell, i (cell.column)}{i === 0 ? '' : gap}<span
          class="cell {cell.column}"
          title={cell.title}>{cell.text}</span
        >{/each}</div>
  {/each}
</div>

<style>
  .feed {
    white-space: pre;
  }
  .row {
    display: block;
    overflow: hidden;
  }
</style>
