// The planning round of one feed (SP4.3d spec §7.0 rules 3–6, §7.1; C62, C62d): it opens when the feed's session ends
// with `endsQualifying` (a live end, `session.end`, a startup restore), for the race `raceFormatOf(format)` plans, the
// feed's team and weekend, and closes when the feed's next session starts. Its cars are our cars of the ended session,
// by slot, each with its race number (C62: the prepared plans are kept by race number). Bookkeeping, no judgement (C43).
import { endsQualifying, known, ourCars, raceFormatOf, unknown, type CarId, type Known, type RaceFormat, type WeekendPhase } from '@pitwall/domain';
import type { AsOfView } from '@pitwall/engine/readers';
import type { EndedSession } from '../pipeline/feed-pipeline.ts';
import type { RaceKey } from './store.ts';

/** What a round is about: the race it plans, the ended session's track, and per our car's slot its race number. */
export type RoundSeat = { key: RaceKey; trackId: number; cars: ReadonlyMap<CarId, number> };

/**
 * The round the ended session `ended` opens, from its run as of its end (`fixed`: our cars and every slot's team and
 * race number); `undefined` when it ends no qualifying (§7.0 rule 3) or names no team for our car.
 */
export function roundSeatOf(ended: EndedSession, fixed: Pick<AsOfView['fixed'], 'playerCar' | 'teammateCar' | 'carKeys'>): RoundSeat | undefined {
  const { phase } = ended;
  if (phase.kind !== 'qualifying' || !endsQualifying(phase)) return undefined;
  const { playerCar, teammateCar, carKeys } = fixed;
  if (!playerCar.known || !carKeys.known) return undefined;
  const team = carKeys.value[playerCar.value]?.teamId;
  if (team === undefined) return undefined;
  const cars = new Map<CarId, number>();
  for (const car of ourCars({ playerCar: playerCar.value, teammateCar: teammateCar.known ? teammateCar.value : undefined })) {
    const key = carKeys.value[car];
    if (key !== undefined && key !== null) cars.set(car, key.raceNumber);
  }
  return { key: { weekendId: ended.weekendId, format: raceFormatOf(phase.format), team }, trackId: ended.trackId, cars };
}

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
