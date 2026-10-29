// Tier-1 alerts (spec 7.7): the active insights and which of them the bar shows.
import { ackToken } from '@pitwall/contracts';
import type { Insight, InsightCategory } from '@pitwall/domain';
import { activeInsights, INSIGHT_CATEGORIES } from '../../kit/folds.ts';

// The fold and the category list live in the kit (widgets use them too); the shell reaches them from here.
export { activeInsights, INSIGHT_CATEGORIES };

/** The critical insights whose occurrence (`ackToken`) is not acknowledged and whose group is not muted, oldest first. */
export function tierOneAlerts(active: Map<string, Insight>, alerts: { acknowledged: string[]; muted: InsightCategory[] }): Insight[] {
  return [...active.values()]
    .filter((i) => i.severity === 'critical' && !alerts.acknowledged.includes(ackToken(i)) && !alerts.muted.includes(i.category))
    .sort((a, b) => a.raisedAt - b.raisedAt);
}

/** At most this many alerts show in the bar; the rest are behind `+N`. */
export const MAX_SHOWN_ALERTS = 3;
