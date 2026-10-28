import type { Insight, SessionTime } from '@pitwall/domain';
import type { InsightChange } from './types.ts';

/** Which insights are active, per source: turns "the conditions that hold now" into raised and resolved changes. */
export class InsightBook {
  /** Per source id, in first-seen order; each source holds its active insights in raise order. */
  readonly #sources = new Map<string, Map<string, Insight>>();

  get active(): Insight[] {
    return [...this.#sources.values()].flatMap((insights) => [...insights.values()]);
  }

  /**
   * Compares `current` (the conditions holding at `at`) with the source's active insights.
   * Resolutions come first, in raise order, then new raises in `current` order. A key present twice counts once.
   */
  apply(sourceId: string, current: readonly Insight[], at: SessionTime): InsightChange[] {
    let active = this.#sources.get(sourceId);
    if (active === undefined) {
      active = new Map();
      this.#sources.set(sourceId, active);
    }
    const currentKeys = new Set(current.map((insight) => insight.key));
    const changes: InsightChange[] = [];
    for (const key of [...active.keys()]) {
      if (currentKeys.has(key)) continue;
      active.delete(key);
      changes.push({ type: 'resolved', key, at });
    }
    for (const insight of current) {
      if (active.has(insight.key)) continue;
      const raised = { ...insight, raisedAt: at };
      active.set(insight.key, raised);
      changes.push({ type: 'raised', insight: raised });
    }
    return changes;
  }
}
