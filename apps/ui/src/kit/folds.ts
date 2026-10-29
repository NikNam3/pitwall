import { addLaps, emptyCurrentLaps, type CurrentLaps, type Insight, type InsightCategory, type LapRecord } from '@pitwall/domain';
import type { Fold, InsightEntry } from '@pitwall/contracts';

/** Folds `laps` entries into the current record of every (car, lap). Copies on write so the store sees a new value. */
export const lapsFold: Fold<LapRecord, CurrentLaps> = {
  init: emptyCurrentLaps,
  add: (acc, entries) => addLaps(acc.map((byLap) => ({ ...byLap })), entries),
};

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

/** Every category, for the mute list; the record makes a new category a type error here. */
const CATEGORY_SET: Record<InsightCategory, true> = { strategy: true, tyres: true, energy: true, car: true, damage: true, race: true, feed: true, system: true };
export const INSIGHT_CATEGORIES = Object.keys(CATEGORY_SET) as InsightCategory[];
