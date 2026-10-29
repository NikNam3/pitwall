<script lang="ts">
  // One line per incident, newest first (V35): minor entries dim, the newest major one amber in the incident moment.
  import { roleOrUndefined } from '../../theme/index.ts';
  import { unknownReason } from '../../kit/text.ts';
  import { columnsFor, incidentRows, widths } from './rows.ts';
  import type { widget } from './widget.ts';
  import type { WidgetProps } from '../../kit/types.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  // Newest first: what does not fit the panel's rows is the oldest and is cut.
  const rows = $derived(incidentRows(data.feed, data.cars, data.moment).slice(0, size.rows));
  const columns = $derived(columnsFor(size.mode));
</script>

<div class="feed">
  {#each rows as row (row.id)}
    <div class="row" style:color={roleOrUndefined(row.role)} data-testid="incident-{row.id}">
      <span class="lead"></span>
      {#each columns as column, i (column)}
        <span class="cell {column}" class:last={i === columns.length - 1} style:width={i === columns.length - 1 ? undefined : `${widths[column] + 2}ch`} title={row.cells[column].reason === undefined ? undefined : unknownReason[row.cells[column].reason]}
          >{row.cells[column].text}</span
        >
      {/each}
    </div>
  {/each}
</div>

<style>
  .feed {
    white-space: nowrap;
  }
  .row {
    display: flex;
  }
  .lead {
    flex: none;
    width: 1ch;
  }
  .cell {
    flex: none;
    overflow: hidden;
  }
  .last {
    flex: 1;
  }
</style>
