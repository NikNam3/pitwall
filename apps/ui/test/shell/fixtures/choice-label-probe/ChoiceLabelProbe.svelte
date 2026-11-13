<script lang="ts">
  // Test-only component: shows the options the shell passed in.
  import type { WidgetProps } from '../../../../src/kit/types.ts';
  import type { widget } from './widget.ts';

  let { options }: WidgetProps<typeof widget> = $props();
</script>

<div data-testid="choice-label-probe">{JSON.stringify(options)}</div>
