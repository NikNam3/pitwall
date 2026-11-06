<script lang="ts">
  // One insight as the top bar renders it (spec 8.3): faint once acknowledged, else by severity; named by its car's code
  // when `cars` has the car (`insightLabel`).
  import type { CarOverview } from '@pitwall/contracts';
  import type { Insight } from '@pitwall/domain';
  import { severityRole } from '../../emphasis/index.ts';
  import { role } from '../../theme/index.ts';
  import { insightLabel } from './insight-text.ts';

  type Props = { insight: Insight; acknowledged: boolean; cars?: readonly CarOverview[] | undefined };
  let { insight, acknowledged, cars }: Props = $props();

  const colour = $derived(role(severityRole(insight.severity, acknowledged)));
</script>

<span class="insight-line" data-severity={insight.severity} style:color={colour}>{insightLabel(insight, cars)}</span>
