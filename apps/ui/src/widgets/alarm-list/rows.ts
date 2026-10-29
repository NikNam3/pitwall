import { ackToken, type AlertsState } from '@pitwall/contracts';
import type { Insight, InsightCategory } from '@pitwall/domain';
import { INSIGHT_CATEGORIES } from '../../kit/folds.ts';

const SEVERITY_ORDER: Record<Insight['severity'], number> = { critical: 0, advisory: 1, info: 2 };

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
  const all = [...active.values()];
  const rows = all
    .filter((insight) => !alerts.muted.includes(insight.category))
    .map((insight): AlarmRow => {
      const token = ackToken(insight);
      return { insight, token, acknowledged: alerts.acknowledged.includes(token) };
    })
    .sort(
      (a, b) =>
        Number(a.acknowledged) - Number(b.acknowledged) ||
        SEVERITY_ORDER[a.insight.severity] - SEVERITY_ORDER[b.insight.severity] ||
        b.insight.raisedAt - a.insight.raisedAt ||
        (a.insight.key < b.insight.key ? -1 : a.insight.key > b.insight.key ? 1 : 0),
    );
  const muted = INSIGHT_CATEGORIES.filter((c) => alerts.muted.includes(c)).map((category) => ({
    category,
    count: all.filter((i) => i.category === category).length,
  }));
  return { rows, muted };
}
