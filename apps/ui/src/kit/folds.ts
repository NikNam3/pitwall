import { addLaps, emptyCurrentLaps, type CurrentLaps, type LapRecord } from '@pitwall/domain';
import type { Fold } from '@pitwall/contracts';

/** Folds `laps` entries into the current record of every (car, lap). Copies on write so the store sees a new value. */
export const lapsFold: Fold<LapRecord, CurrentLaps> = {
  init: emptyCurrentLaps,
  add: (acc, entries) => addLaps(acc.map((byLap) => ({ ...byLap })), entries),
};
