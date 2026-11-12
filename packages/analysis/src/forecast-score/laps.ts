// What `forecast-score` reads of the projection's laps and stops (SP4.3a spec 7.1): every car's confirmed lap records by
// lap number (the current records, C25), the tyre type of each lap and each stop, and the stops that change it (a
// weather crossover). Pure functions of the projection.
import { currentLaps, NOISE_COMPOUNDS, type CarId, type FrameNumber, type LapRecord, type NoiseCompound, type PitStopRecord, type StintRecord } from '@pitwall/domain';
import type { DeepReadonly, Projection } from '@pitwall/engine/readers';

/** The tyre types of the wet: a lap on them is no dry lap. */
const WET: ReadonlySet<string> = new Set(['inter', 'wet']);

export const isNoiseCompound = (c: string): c is NoiseCompound => (NOISE_COMPOUNDS as readonly string[]).includes(c);

/** Every car's confirmed lap records by lap number, the stints and the stops, read once from a projection. */
export type RaceLaps = {
  /** One more than the highest car slot with a lap record. */
  cars: number;
  /** Car `car`'s confirmed record of lap `n`. */
  lap(car: CarId | number, n: number): DeepReadonly<LapRecord> | undefined;
  /** Car `car`'s confirmed records, by lap number ascending. */
  lapsOf(car: CarId | number): readonly DeepReadonly<LapRecord>[];
  /** The compound car `car` left the pits on after its stop on lap `lap`: the stint starting on lap `lap + 1`, else its
   *  lap `lap + 2` record's (never the out-lap record's, which carries the old set). */
  compoundAfter(car: CarId | number, lap: number): NoiseCompound | undefined;
  /** Whether car `car`'s lap `n` is on inter or wet tyres. */
  wetLap(car: CarId | number, n: number): boolean;
  /** Whether car `car`'s stop on lap `lap` is a weather crossover: from slicks to inter or wet tyres, or back. */
  crossover(car: CarId | number, lap: number): boolean;
  /** Whether car `car`'s laps `from` to `to` are dry and hold no weather crossover. */
  dry(car: CarId | number, from: number, to: number): boolean;
  /** Whether any of car `car`'s confirmed laps `from` to `to` ran partly under an SC or VSC (`scShare + vscShare > 0`). */
  neutralised(car: CarId | number, from: number, to: number): boolean;
  /** The frame on which car `car` made its stop `stop` (its in-lap record's, else the stop's own). */
  inLapFrame(stop: DeepReadonly<PitStopRecord>): FrameNumber;
};

/** The race's laps of `history`. */
export function raceLaps(history: DeepReadonly<Projection>): RaceLaps {
  const byCar: DeepReadonly<LapRecord>[][] = [];
  const byNumber: Map<number, DeepReadonly<LapRecord>>[] = [];
  for (const l of currentLaps(history.laps as readonly LapRecord[])) {
    if (l.status !== 'confirmed') continue;
    (byCar[l.carId] ??= []).push(l);
    (byNumber[l.carId] ??= new Map()).set(l.lapNumber, l);
  }
  const stints: DeepReadonly<StintRecord>[][] = [];
  for (const s of history.stints) (stints[s.carId] ??= []).push(s);
  const stops = new Map<string, boolean>();
  for (const s of history.pitStops) stops.set(`${s.carId}:${s.lap}`, true);

  const lap = (car: number, n: number) => byNumber[car]?.get(n);
  const visualOf = (car: number, n: number): string | undefined =>
    lap(car, n)?.visualCompound ?? stints[car]?.find((s) => s.firstLap <= n && n <= s.lastLap)?.visualCompound;
  const wetLap = (car: number, n: number): boolean => WET.has(visualOf(car, n) ?? '');
  const compoundAfter = (car: number, n: number): NoiseCompound | undefined => {
    // The out-lap record (lap n + 1) still carries the old set's compound in F1 25 (Task 11b, F8 cause 5): the stint
    // that starts on lap n + 1, else (its record is written at its end) the lap n + 2 record; else unknown (C3).
    const next = stints[car]?.find((s) => s.firstLap === n + 1)?.visualCompound ?? lap(car, n + 2)?.visualCompound;
    return next !== undefined && isNoiseCompound(next) ? next : undefined;
  };
  const crossover = (car: number, n: number): boolean => {
    const before = visualOf(car, n);
    const after = compoundAfter(car, n);
    return before !== undefined && after !== undefined && WET.has(before) !== WET.has(after);
  };
  return {
    cars: byCar.length,
    lap,
    lapsOf: (car) => byCar[car] ?? [],
    compoundAfter,
    wetLap,
    crossover,
    dry: (car, from, to) => {
      for (let n = from; n <= to; n++) if (wetLap(car, n) || (stops.has(`${car}:${n}`) && crossover(car, n))) return false;
      return true;
    },
    neutralised: (car, from, to) => {
      for (let n = from; n <= to; n++) {
        const l = lap(car, n);
        if (l !== undefined && l.scShare + l.vscShare > 0) return true;
      }
      return false;
    },
    inLapFrame: (stop) => lap(stop.carId, stop.lap)?.frame ?? stop.frame,
  };
}
