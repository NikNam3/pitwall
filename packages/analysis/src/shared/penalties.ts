// The one classification of the F1 25 `penaltyType` codes (data-output spec, "Penalty types"), shared by incidents and alarms.
import type { PenaltyKind } from '@pitwall/domain';

/** F1 25 `penaltyType` codes that are rulings against the car, and which ruling each is. */
const PENALTY_KINDS: ReadonlyMap<number, PenaltyKind> = new Map([
  [0, 'driveThrough'],
  [1, 'stopGo'],
  [2, 'grid'],
  [4, 'time'],
  [6, 'disqualified'],
  [9, 'tyreRegulations'],
]);
/** The F1 25 `penaltyType` code of a warning. */
const WARNING_TYPE = 5;

/**
 * What a PENA event's `penaltyType` is: a real `penalty`, a `warning`, or `none` (a penalty reminder, a lap
 * invalidation, a timer, a retirement and the like: no ruling of its own).
 */
export type PenaltyClass = 'penalty' | 'warning' | 'none';

/** Classifies a PENA event's `penaltyType` param; anything but a known numeric code is `none`. */
export function penaltyClass(penaltyType: number | string | undefined): PenaltyClass {
  if (penaltyType === WARNING_TYPE) return 'warning';
  return penaltyKind(penaltyType) === undefined ? 'none' : 'penalty';
}

/** The ruling of a PENA event's `penaltyType` param; `undefined` for anything `penaltyClass` does not count as a penalty. */
export function penaltyKind(penaltyType: number | string | undefined): PenaltyKind | undefined {
  return typeof penaltyType === 'number' ? PENALTY_KINDS.get(penaltyType) : undefined;
}

/**
 * Where the car's `warnings`-th warning stands on the way to the next penalty, `1..before`: the game's count runs on
 * after a penalty, so this assumes a penalty every `before` warnings (not verified against the game). Shared by
 * alarms (one warning left) and incidents (`warning 2/3`). Without a limit (`before` below 1) the count is as it is.
 */
export const warningInCycle = (warnings: number, before: number): number => (before >= 1 ? ((warnings - 1) % before) + 1 : warnings);
