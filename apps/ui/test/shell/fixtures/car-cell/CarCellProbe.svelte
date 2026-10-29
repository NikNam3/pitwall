<script lang="ts">
  import type { WidgetProps } from '../../../../src/kit/types.ts';
  import Value from '../../../../src/kit/values/Value.svelte';
  import type { widget } from './widget.ts';

  let { data }: WidgetProps<typeof widget> = $props();
  const format = (v: number): string => String(v);
</script>

<div data-testid="car-cell-probe">
  <span data-testid="brake"><Value value={812} {format} car={{ updatedAt: data.car.updatedAt, field: 'condition.brakes.tempC' }} /></span>
  <span data-testid="wear"><Value value={18} {format} car={{ updatedAt: data.car.updatedAt, field: 'tyres.corners.wearPct' }} /></span>
</div>
