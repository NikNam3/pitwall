// Builders of the `degradation` tests (spec 4.1): synthetic stints whose lap times are a base pace, a constant
// degradation per lap of tyre age, the fuel effect `γ · fuelAtStartKg` and a given noise; priors snapshots and stored
// sources passed explicitly (C84: no test reads the priors store or storage).
import {
  carId,
  known,
  unknown,
  type ActualCompound,
  type Corners,
  type Known,
  type LapRecord,
  type Percent,
  type PitStopRecord,
  type PriorsSnapshot,
  type StintRecord,
  type VisualCompound,
  type WeekendPhase,
} from '@pitwall/domain';
import type { EngineView, StoredSource } from '@pitwall/engine/readers';
import { DEGRADATION_CONFIG } from '../../src/degradation/index.ts';
import { lap } from '../../../../test-support/builders/index.ts';
import { RACE } from '../situated.ts';

/** The fuel effect of the default config, ms per kg (spec 7). */
export const GAMMA = DEGRADATION_CONFIG.defaults.gammaMsPerKg;
/** The base pace of every synthetic stint at tyre age 0 and no fuel, in ms. */
export const BASE_MS = 87_000;

const corners = <T>(v: T): Corners<T> => ({ fl: v, fr: v, rl: v, rr: v });

/** What a synthetic stint is. Lap `n`'s time is `BASE_MS + nu · age + γ · fuel + noise(i)`, rounded to whole ms. */
export type StintSpec = {
  car?: number;
  /** The stint's first and last lap numbers. */
  from: number;
  to: number;
  /** Tyre age at the start of lap `from` (default 0); one more per lap. */
  ageAtFrom?: number;
  /** Degradation per lap of tyre age, ms (default 80). */
  nu?: number;
  /** Fuel at the start of lap `from`, kg (default 100), and the burn per lap (default 1.5 kg, so `γ · fuel` is whole ms). */
  fuelAtFrom?: number;
  burnKg?: number;
  /** The noise of the stint's `i`-th lap (0-based), ms (default 0). */
  noise?: (i: number) => number;
  actual?: ActualCompound;
  visual?: VisualCompound;
  /** Fuel and wear hidden as realism hides a rival's (`unknown('realism')`). */
  hidden?: boolean;
  /** Per-lap overrides, by lap number. */
  over?: Record<number, Partial<LapRecord>>;
};

/** The fuel at the start of lap `n` of `spec`, kg. */
export const fuelAt = (spec: Pick<StintSpec, 'from' | 'fuelAtFrom' | 'burnKg'>, n: number): number =>
  (spec.fuelAtFrom ?? 100) - (spec.burnKg ?? 1.5) * (n - spec.from);

/** The laps of a synthetic stint, lap records as the projection holds them; `completedAt` is cumulative from 0. */
export function stintLaps(spec: StintSpec): LapRecord[] {
  const { car = 0, from, to, ageAtFrom = 0, nu = 80, noise = () => 0, actual = 'C3', visual = 'soft', hidden = false, over = {} } = spec;
  const burn = spec.burnKg ?? 1.5;
  const laps: LapRecord[] = [];
  let at = (from - 1) * 90_000;
  for (let n = from; n <= to; n++) {
    const i = n - from;
    const age = ageAtFrom + i;
    const fuel = fuelAt(spec, n);
    const lapTimeMs = Math.round(BASE_MS + nu * age + GAMMA * fuel + noise(i));
    at += lapTimeMs;
    const wearStart = known(age as Percent, at);
    const wearEnd = known((age + 1) as Percent, at);
    const realism: Known<never> = unknown('realism');
    laps.push(
      lap({
        carId: carId(car),
        lapNumber: n,
        lapTimeMs,
        completedAt: at,
        actualCompound: actual,
        visualCompound: visual,
        tyreAgeAtStart: age,
        fuelAtStartKg: hidden ? realism : known(fuel, at),
        fuelAtEndKg: hidden ? realism : known(fuel - burn, at),
        wearAtStartPct: hidden ? corners(realism) : corners(wearStart),
        wearAtEndPct: hidden ? corners(realism) : corners(wearEnd),
        ...over[n],
      }),
    );
  }
  return laps;
}

/** A symmetric noise: +amp, −amp, +amp … over an odd number of laps it is uncorrelated with the tyre age. */
export const alternating =
  (amp: number) =>
  (i: number): number =>
    i % 2 === 0 ? amp : -amp;

/** The closed stint record of laps `firstLap..lastLap` of car `car`. */
export const stintRecord = (over: Partial<StintRecord> & Pick<StintRecord, 'firstLap' | 'lastLap'>): StintRecord => ({
  carId: carId(0),
  actualCompound: 'C3',
  visualCompound: 'soft',
  tyreAgeAtFitting: 0,
  frame: 0,
  ...over,
});

/** A green-flag pit stop of car `car` at the end of lap `lap`. */
export const pitStop = (over: Partial<PitStopRecord> & Pick<PitStopRecord, 'lap'>): PitStopRecord => ({
  carId: carId(0),
  pitLaneEntry: 0,
  pitLaneExit: 0,
  pitLaneTimeMs: 20_000,
  stationaryTimeMs: 2_500,
  flag: 'green',
  penaltyServed: false,
  frame: 0,
  ...over,
});

/** Degradation priors of one compound: `α` offset, `ν` and its sd. */
export type CompoundPriors = { alphaOffsetMs?: number; nuMsPerLap: number; nuSdMs: number };

/** A priors snapshot (C62a) of set `set` ("Zandvoort long runs", 3 sources) holding these compounds' degradation entries. */
export function priorsSnapshot(byCompound: Partial<Record<VisualCompound, CompoundPriors>>, set = { id: 'long-runs', name: 'Zandvoort long runs', sources: 3 }): PriorsSnapshot {
  const entries: PriorsSnapshot['entries'] = {};
  for (const [compound, p] of Object.entries(byCompound)) {
    entries[`degradation.alphaOffsetMs.${compound}`] = known(p.alphaOffsetMs ?? 0, 0);
    entries[`degradation.nuMsPerLap.${compound}`] = known(p.nuMsPerLap, 0);
    entries[`degradation.nuSdMs.${compound}`] = known(p.nuSdMs, 0);
  }
  return { fingerprint: `fp-${set.id}`, setId: set.id, setName: set.name, sources: set.sources, entries };
}

/** `view.priors` holding `snapshot` (C62a). */
export const viewPriors = (snapshot: PriorsSnapshot): EngineView['priors'] => known(snapshot, 0);

/** A stored source (C62a) of car 0: its stint's laps in a session of weekend phase `phase`; no track file. */
export function storedSource(laps: LapRecord[], { phase = RACE, pitStops = [] }: { phase?: WeekendPhase; pitStops?: PitStopRecord[] } = {}): StoredSource {
  const first = laps[0]!;
  const last = laps.at(-1)!;
  return {
    source: { sessionUid: '42', weekendId: 'w1', feedCar: carId(0), car: first.carId, firstLap: first.lapNumber, excludedLaps: [] },
    phase,
    stint: stintRecord({ carId: first.carId, firstLap: first.lapNumber, lastLap: last.lapNumber, actualCompound: first.actualCompound, visualCompound: first.visualCompound, tyreAgeAtFitting: first.tyreAgeAtStart }),
    laps,
    pitStops,
    sessionLaps: laps,
    track: unknown('notApplicable'),
  };
}
