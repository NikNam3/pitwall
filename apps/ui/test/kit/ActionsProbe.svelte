<script lang="ts">
  // Test-only widget: hands the `send` it gets from `getUiActions()` to the test.
  import type { UiAction } from '@pitwall/contracts';
  import { getUiActions } from '../../src/kit/actions.ts';

  let { onSend }: { onSend: (send: (action: UiAction) => void) => void } = $props();

  // svelte-ignore state_referenced_locally
  onSend(getUiActions().send);
</script>
