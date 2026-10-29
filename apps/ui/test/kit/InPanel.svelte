<script lang="ts">
  // Test-only parent of any widget component: provides the panel staleness context (cadence from the props) and shows `staleForMs`.
  import type { Component } from 'svelte';
  import { providePanelStale } from '../../src/kit/stale/panel-stale.ts';

  type Props = { component: Component<Record<string, unknown>>; widgetProps: Record<string, unknown>; cadenceMs?: number };
  let { component: View, widgetProps, cadenceMs }: Props = $props();

  const panel = providePanelStale({ cadenceMs: () => cadenceMs });
</script>

<View {...widgetProps} />
<output data-testid="stale-for">{panel.staleForMs ?? ''}</output>
