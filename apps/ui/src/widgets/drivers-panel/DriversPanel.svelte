<script lang="ts">
  // Test-phase stub (SP4.3b2 Task 16): the implement phase replaces it.
  import type { WidgetProps } from '../../kit/types.ts';
  import type { widget } from './widget.ts';

  let props: WidgetProps<typeof widget> = $props();
  // svelte-ignore state_referenced_locally
  void props;
  throw new Error('not implemented');
</script>
