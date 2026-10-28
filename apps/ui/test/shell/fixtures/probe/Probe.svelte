<script lang="ts">
  // Test-only component: shows what the shell passed in, as text the tests read.
  import type { WidgetProps } from '../../../../src/kit/types.ts';
  import { usePanelStale } from '../../../../src/kit/stale/panel-stale.ts';
  import type { widget } from './widget.ts';

  let { data, options, size, link }: WidgetProps<typeof widget> = $props();
  const stale = usePanelStale();
</script>

<div data-testid="probe">
  <span data-testid="status-feed">{data.status.feedId}</span>
  <span data-testid="detail">{data.detail === undefined ? 'undefined' : 'defined'}</span>
  <span data-testid="options">{JSON.stringify(options)}</span>
  <span data-testid="size-mode">{size.mode}</span>
  <span data-testid="link-primary">{link.primary}</span>
  <span data-testid="clock-now">{stale?.clock.now() ?? 'none'}</span>
</div>
