<script lang="ts">
  // Test-only: provides the panel staleness context and hands the state to the test.
  import { providePanelStale, type PanelStale } from '../../src/kit/stale/panel-stale.svelte.ts';

  let { onPanel }: { onPanel: (panel: PanelStale) => void } = $props();
  // svelte-ignore state_referenced_locally
  onPanel(providePanelStale());
</script>
