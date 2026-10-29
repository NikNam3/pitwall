<script lang="ts">
  // Fuel margin in laps, burn, save target and the game's own estimate (V20, spec 8.2).
  import type { WidgetProps } from '../../kit/types.ts';
  import { unknownReason } from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';
  import { fuelRows } from './rows.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  // Compact keeps the two rows that decide the stint: margin and what the fuel lasts.
  const COMPACT_ROWS = 2;
  const rows = $derived(size.mode === 'full' ? fuelRows(data.fuel) : fuelRows(data.fuel).slice(0, COMPACT_ROWS));
</script>

<div class="fuel">
  {#each rows as row (row.key)}
    <div class="row" class:dim={row.dim} class:bold={row.bold} style:color={row.role === undefined ? undefined : role(row.role)}>
      <span class="label">{row.label}</span>
      <span class="text" title={row.reason === undefined ? undefined : unknownReason[row.reason]}>{row.text}</span>
    </div>
  {/each}
</div>

<style>
  .fuel {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: flex;
  }
  .label {
    min-width: 7ch;
    color: var(--pw-textDim);
  }
  .bold {
    font-weight: bold;
  }
  .dim .text {
    color: var(--pw-textDim);
  }
</style>
