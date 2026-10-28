<script lang="ts">
  import type { WidgetProps } from '../../../../src/kit/types.ts';
  import { linkLog } from './link-log.ts';
  import type { widget } from './widget.ts';

  let { link }: WidgetProps<typeof widget> = $props();
  $effect(() => {
    linkLog.push(link);
  });
</script>

<div data-testid="link-probe">{link.primary}</div>
