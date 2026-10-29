// The one classification of the F1 25 `penaltyType` codes (data-output spec, "Penalty types"), shared by incidents and alarms.

/** F1 25 `penaltyType` codes that are rulings against the car: drive-through, stop-go, grid, time, disqualified, tyre regulations. */
const PENALTY_TYPES: ReadonlySet<number> = new Set([0, 1, 2, 4, 6, 9]);
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
  return typeof penaltyType === 'number' && PENALTY_TYPES.has(penaltyType) ? 'penalty' : 'none';
}

/**
 * Where the car's `warnings`-th warning stands on the way to the next penalty, `1..before`: the game's count runs on
 * after a penalty, so this assumes a penalty every `before` warnings (not verified against the game). Shared by
 * alarms (one warning left) and incidents (`warning 2/3`). Without a limit (`before` below 1) the count is as it is.
 */
export const warningInCycle = (warnings: number, before: number): number => (before >= 1 ? ((warnings - 1) % before) + 1 : warnings);
