// Tier-1 alerts (spec 7.7): the active insights and which of them the bar shows.
import { ackToken, type Fold, type InsightEntry } from '@pitwall/contracts';
import type { Insight, InsightCategory } from '@pitwall/domain';

/** Folds `insights` entries into the insights active now, by key. Copies on write so the store sees a new value. */
export const activeInsights: Fold<InsightEntry, Map<string, Insight>> = {
  init: () => new Map(),
  add: (acc, entries) => {
    const next = new Map(acc);
    for (const entry of entries) {
      if (entry.type === 'raised') next.set(entry.insight.key, entry.insight);
      else next.delete(entry.key);
    }
    return next;
  },
};

/** The critical insights whose occurrence (`ackToken`) is not acknowledged and whose group is not muted, oldest first. */
export function tierOneAlerts(active: Map<string, Insight>, alerts: { acknowledged: string[]; muted: InsightCategory[] }): Insight[] {
  return [...active.values()]
    .filter((i) => i.severity === 'critical' && !alerts.acknowledged.includes(ackToken(i)) && !alerts.muted.includes(i.category))
    .sort((a, b) => a.raisedAt - b.raisedAt);
}

/** Every category, for the mute list; the record makes a new category a type error here. */
const CATEGORY_SET: Record<InsightCategory, true> = { strategy: true, tyres: true, energy: true, damage: true, race: true, feed: true, system: true };
export const INSIGHT_CATEGORIES = Object.keys(CATEGORY_SET) as InsightCategory[];

/** At most this many alerts show in the bar; the rest are behind `+N`. */
export const MAX_SHOWN_ALERTS = 3;
