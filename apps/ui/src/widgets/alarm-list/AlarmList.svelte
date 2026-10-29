<script lang="ts">
  // Stub of the test phase so the declaration typechecks; the implementer replaces it.
  import type { WidgetProps } from '../../kit/types.ts';
  import type { widget } from './widget.ts';

  let { data }: WidgetProps<typeof widget> = $props();
</script>

<span>{data.insights.size}</span>
