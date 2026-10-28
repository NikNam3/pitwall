<script lang="ts">
  // Test-only parent of a value cell: provides the panel staleness context and shows `staleForMs`.
  import type { Known } from '@pitwall/domain';
  import Value from '../../src/kit/values/Value.svelte';
  import { providePanelStale } from '../../src/kit/stale/panel-stale.ts';
  import type { CarFieldPath } from '../../src/kit/values/car-sources.ts';

  type Props = {
    value: Known<number> | number;
    format?: (v: number) => string;
    car?: { updatedAt: Partial<Record<string, number>>; field: CarFieldPath };
    estimated?: boolean;
    /** The session clock the panel reads, and the measured cadence of the menu-rate sources. */
    now?: number;
    cadenceMs?: number;
  };
  let { value, format = (v: number) => `#${v}`, car, estimated, now, cadenceMs }: Props = $props();

  const panel = providePanelStale({ now: () => now, cadenceMs: () => cadenceMs });
</script>

<Value {value} {format} {car} {estimated} />
<output data-testid="stale-for">{panel.staleForMs ?? ''}</output>
