// The planning round's bookkeeping (SP4.3d spec §7.1, SP4.3e spec §4.3, SP4.3f spec §4.2–4.3; C3, C62, C62c, C62d): the
// race laps the bridge suggests, our cars of a stored qualifying by slot, each with its race number (C62: the prepared
// plans are kept by race number), the slots a profile snapshot is asked for, and the round's effective forecast. No
// judgement (C43).
import { known, unknown, type Celsius, type CarId, type EnteredSample, type ForecastSample, type Known, type RaceConditions, type RaceFormat, type SessionTime, type TeamId, type WeekendPhase } from '@pitwall/domain';
import type { SlotIdentity } from '../drivers/store.ts';
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

/** The team of `row`'s player car (C62); `undefined` when its slots do not carry the player car. */
export const teamOfRow = (row: Pick<StoredSessionRow, 'playerCar' | 'cars'>): TeamId | undefined =>
  row.cars.find((c) => c.carId === row.playerCar)?.carKey.teamId;

/** Our cars of the stored session `row` (its player car and teammate), by slot, each with its race number. */
export function roundCarsOf(row: Pick<StoredSessionRow, 'playerCar' | 'teammateCar' | 'cars'>): Map<CarId, number> {
  const cars = new Map<CarId, number>();
  for (const car of row.teammateCar === null ? [row.playerCar] : [row.playerCar, row.teammateCar]) {
    const slot = row.cars.find((c) => c.carId === car);
    if (slot !== undefined) cars.set(car, slot.carKey.raceNumber);
  }
  return cars;
}

/** Every car slot of the stored session `row` as a session start asks the profile store for them (C62c). */
export const slotsOfRow = (row: Pick<StoredSessionRow, 'cars'>): SlotIdentity[] =>
  row.cars.map((c) => ({ carId: c.carId, teamId: c.carKey.teamId, raceNumber: c.carKey.raceNumber, name: c.driver.known ? c.driver.value : null }));

/**
 * The qualifying at its end: its race-clock time (when its race samples were last known) and its own temperatures, an
 * entered row's temperatures where no imported row is (C3).
 */
export type TempsAtEnd = { at: SessionTime; trackTempC: Celsius; airTempC: Celsius };

/** The imported sample nearest in offset to `offsetMs` (the earlier one on a tie); `undefined` without any. */
const nearest = (imported: readonly ForecastSample[], offsetMs: number): ForecastSample | undefined =>
  imported.reduce<ForecastSample | undefined>((best, s) => (best === undefined || Math.abs(s.offsetMs - offsetMs) < Math.abs(best.offsetMs - offsetMs) ? s : best), undefined);

/**
 * An entered row as a full sample (ruling 4984302c): its offset, weather and rain chance; the temperatures and trends of
 * the imported row nearest in offset, else the qualifying's own at its end with trends `flat` (never a made-up 0, C3).
 */
function fullSampleOf(entered: EnteredSample, imported: readonly ForecastSample[], atEnd: TempsAtEnd): ForecastSample {
  const near = nearest(imported, entered.offsetMs);
  return {
    offsetMs: entered.offsetMs,
    weather: entered.weather,
    trackTempC: near?.trackTempC ?? atEnd.trackTempC,
    trackTempTrend: near?.trackTempTrend ?? 'flat',
    airTempC: near?.airTempC ?? atEnd.airTempC,
    airTempTrend: near?.airTempTrend ?? 'flat',
    rainPct: entered.rainPct,
  };
}

/**
 * The race's forecast a round plans on (C62d): the imported samples (the qualifying's race samples at its end), or the
 * entered rows as full samples. The one function the replay's as-of view and the round's published rows both use.
 */
export function effectiveForecast(conditions: RaceConditions, imported: readonly ForecastSample[], atEnd: TempsAtEnd): ForecastSample[] {
  return conditions.kind === 'imported' ? imported.map((s) => ({ ...s })) : conditions.samples.map((s) => fullSampleOf(s, imported, atEnd));
}

/**
 * The round's forecast rows (C3, C62d): per effective sample whether the user's entry differs from the imported row at
 * the same offset (one with no imported row at its offset is overridden); `unknown('notReceived')` while none is known.
 */
export function forecastRowsOf(conditions: RaceConditions, imported: readonly ForecastSample[], atEnd: TempsAtEnd): Known<{ sample: ForecastSample; overridden: boolean }[]> {
  const samples = effectiveForecast(conditions, imported, atEnd);
  if (samples.length === 0) return unknown('notReceived');
  const rows = samples.map((sample) => {
    if (conditions.kind === 'imported') return { sample, overridden: false };
    const same = imported.find((s) => s.offsetMs === sample.offsetMs);
    return { sample, overridden: same === undefined || same.weather !== sample.weather || same.rainPct !== sample.rainPct };
  });
  return known(rows, atEnd.at);
}
