<script lang="ts">
  // One insight as the top bar renders it (spec 8.3): faint once acknowledged, else by severity.
  import type { Insight } from '@pitwall/domain';
  import { severityRole } from '../../emphasis/index.ts';
  import { role } from '../../theme/index.ts';
  import { formatInsight } from './insight-text.ts';

  type Props = { insight: Insight; acknowledged: boolean };
  let { insight, acknowledged }: Props = $props();

  const colour = $derived(role(severityRole(insight.severity, acknowledged)));
</script>

<span class="insight-line" data-severity={insight.severity} style:color={colour}>{formatInsight(insight)}</span>
