<script lang="ts">
  import type { WidgetProps } from '../../../../src/kit/types.ts';
  import type { widget } from './widget.ts';

  let { size }: WidgetProps<typeof widget> = $props();
</script>

<div data-testid="cells">{size.cols}x{size.rows}</div>
