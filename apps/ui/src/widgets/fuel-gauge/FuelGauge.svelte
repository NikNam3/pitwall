<script lang="ts">
  // Fuel margin in laps, burn, save target and the game's own estimate (V20, spec 8.2).
  import type { WidgetProps } from '../../kit/types.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { fuelRows, type FuelRow } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  // Compact keeps the two rows that decide the stint: margin and what the fuel lasts.
  const COMPACT_KEYS: readonly FuelRow['key'][] = ['fuel', 'margin'];
  const rows = $derived(size.mode === 'full' ? fuelRows(data.fuel) : fuelRows(data.fuel).filter((r) => COMPACT_KEYS.includes(r.key)));
</script>

<div class="fuel">
  {#each rows as row (row.key)}
    <div class="row" class:dim={row.dim} class:bold={row.bold}>
      <span class="label" style:min-width="{text.labelWidth}ch">{row.label}</span>
      <span class="text"><TextCell text={row.text} reason={row.reason} role={row.role} /></span>
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
    color: var(--pw-textDim);
  }
  .bold {
    font-weight: bold;
  }
  .dim .text {
    color: var(--pw-textDim);
  }
</style>
