<script lang="ts">
  // One insight as the top bar renders it (spec 8.3): faint once acknowledged, else by severity.
  import type { Insight } from '@pitwall/domain';
  import { role, type Role } from '../../theme/index.ts';
  import { formatInsight } from './insight-text.ts';

  type Props = { insight: Insight; acknowledged: boolean };
  let { insight, acknowledged }: Props = $props();

  const BY_SEVERITY: Record<Insight['severity'], Role> = { critical: 'critical', advisory: 'warning', info: 'textDim' };
  const colour = $derived(role(acknowledged ? 'textFaint' : BY_SEVERITY[insight.severity]));
</script>

<span class="insight-line" data-severity={insight.severity} style:color={colour}>{formatInsight(insight)}</span>
