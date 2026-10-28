<script lang="ts">
  import type { WidgetProps } from '../../../../src/kit/types.ts';
  import { usePanelStale } from '../../../../src/kit/stale/panel-stale.ts';
  import type { widget } from './widget.ts';

  let { data }: WidgetProps<typeof widget> = $props();
  usePanelStale()?.reportStale(Symbol('cell'), 4000);
</script>

<div data-testid="stale-probe">{data.status.feedId}</div>
