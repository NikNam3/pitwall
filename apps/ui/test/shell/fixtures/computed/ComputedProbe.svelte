<script lang="ts">
  import type { WidgetProps } from '../../../../src/kit/types.ts';
  import type { widget } from './widget.ts';

  let { data }: WidgetProps<typeof widget> = $props();
</script>

<div data-testid="computed-probe">{typeof data.detail}</div>
