// The planning round's bookkeeping (SP4.3d spec §7.1, SP4.3e spec §4.3; C62, C62d): the race laps the bridge suggests,
// and our cars of a stored qualifying by slot, each with its race number (C62: the prepared plans are kept by race
// number). No judgement (C43).
import { known, unknown, type CarId, type CarKey, type Known, type RaceFormat, type WeekendPhase } from '@pitwall/domain';
import type { StoredSessionRow } from '../storage/db.ts';

/** A stored session as the suggestion reads it: its weekend phase (none when stale) and its settings. */
export type StoredRace = { stale: boolean; phase?: WeekendPhase; settings: Record<string, string | number | boolean> };

/**
 * The race laps the bridge suggests (§7.1 step 3): the `totalLaps` of the newest of `sessions` (a track's stored
 * sessions in start order) that is a race of `format`; `notReceived` without one.
 */
export function suggestedLapsOf(sessions: readonly StoredRace[], format: RaceFormat): Known<number> {
  const race = sessions.findLast((s) => !s.stale && s.phase?.kind === 'race' && s.phase.format === format && typeof s.settings['totalLaps'] === 'number');
  return race === undefined ? unknown('notReceived') : known(race.settings['totalLaps'] as number, 0);
}

const sameCar = (a: CarKey, b: CarKey): boolean => a.teamId === b.teamId && a.raceNumber === b.raceNumber;

/** Whether `row`'s player car had `seat`'s team and race number (C62: the session of that seat). */
export const isSeatOf = (row: Pick<StoredSessionRow, 'playerCar' | 'cars'>, seat: CarKey): boolean => {
  const own = row.cars.find((c) => c.carId === row.playerCar);
  return own !== undefined && sameCar(own.carKey, seat);
};

/** Our cars of the stored session `row` (its player car and teammate), by slot, each with its race number. */
export function roundCarsOf(row: Pick<StoredSessionRow, 'playerCar' | 'teammateCar' | 'cars'>): Map<CarId, number> {
  const cars = new Map<CarId, number>();
  for (const car of row.teammateCar === null ? [row.playerCar] : [row.playerCar, row.teammateCar]) {
    const slot = row.cars.find((c) => c.carId === car);
    if (slot !== undefined) cars.set(car, slot.carKey.raceNumber);
  }
  return cars;
}
