import type { AlertsState, Fold, InsightEntry } from '@pitwall/contracts';
import type { Insight, InsightCategory } from '@pitwall/domain';

/**
 * Folds `insights` entries into the insights active now, by key (copies on write). The same fold as the top bar's
 * `activeInsights`: a widget may not import the shell, so a copy lives here until the supervisor moves it to `kit/folds.ts`.
 */
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

/** One listed alarm. */
export type AlarmRow = { insight: Insight; token: string; acknowledged: boolean };

/** What the list shows: the rows, and the muted categories with how many active alarms each hides. */
export type AlarmView = { rows: AlarmRow[]; muted: Array<{ category: InsightCategory; count: number }> };

/**
 * Joins the active insights (by key) with `ui.alerts`. Muted categories drop out of `rows` and are counted in `muted`
 * (INSIGHT_CATEGORIES order, categories with no active alarm included with count 0). Order: unacknowledged first, then
 * acknowledged; within each by severity (critical, advisory, info), newest `raisedAt` first, then key.
 */
export function alarmRows(active: ReadonlyMap<string, Insight>, alerts: AlertsState): AlarmView {
  throw new Error(`not implemented: ${active.size} ${alerts.muted.length}`);
}
