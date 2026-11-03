import type { Insight, SessionTime } from '@pitwall/domain';
import type { InsightChange } from './types.ts';

/** The active insights per source, as `InsightBook.snapshot` saves them: the insights are shared, never changed. */
export type InsightBookState = ReadonlyMap<string, ReadonlyMap<string, Insight>>;

const copySources = (sources: InsightBookState): Map<string, Map<string, Insight>> =>
  new Map([...sources].map(([source, insights]) => [source, new Map(insights)]));

/** Which insights are active, per source: turns "the conditions that hold now" into raised and resolved changes. */
export class InsightBook {
  /** Per source id, in first-seen order; each source holds its active insights in raise order. */
  #sources = new Map<string, Map<string, Insight>>();

  get active(): Insight[] {
    return [...this.#sources.values()].flatMap((insights) => [...insights.values()]);
  }

  /** The active insights now; later changes leave it as it is. */
  snapshot(): InsightBookState {
    return copySources(this.#sources);
  }

  /** Makes the active insights those of `state` again. */
  restore(state: InsightBookState): void {
    this.#sources = copySources(state);
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
