// One stint through `degradation`'s rules (spec 4.1), shared by the calculator and the priors (so a source's `lapUse`
// is the calculator's): each lap's use, its fuel correction, the filter over the pace laps, the basis and the wear rates.
import { addLaps, emptyCurrentLaps, known, unknown, type CarId, type Corners, type Known, type LapRecord, type LapUse, type Ms } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { classifyLap, type LapClassOptions } from '../lap-classes/index.ts';
import { perLapGainRate, type GainSample, type RateOptions } from '../per-lap-rate/index.ts';
import type { DEGRADATION_CONFIG } from './config.ts';
import type { DegradationLap } from './types.ts';
import { runFilter, type FilterLap, type FilterPrior, type FilterState } from './kalman.ts';

type Lap = DeepReadonly<LapRecord>;
type Config = (typeof DEGRADATION_CONFIG)['defaults'];

type Corner = keyof Corners<unknown>;

/** The excluded uses, one value each: read only, shared by every lap they describe. */
const IN_LAP: LapUse = Object.freeze({ excluded: 'inLap' });
const OUT_LAP: LapUse = Object.freeze({ excluded: 'outLap' });
const NEUTRALISED: LapUse = Object.freeze({ excluded: 'neutralised' });
const NOT_FOR_PACE: LapUse = Object.freeze({ excluded: 'notForPace' });

/**
 * A lap's use before the filter: excluded with its reason, or a pace lap (`forPace`, `lap-classes`) the filter reads.
 * A rate lap (`forRate`) is a pace lap or one excluded as `notForPace`.
 */
export function lapClassOf(lap: Lap, classes: LapClassOptions): LapUse | 'pace' {
  const cls = classifyLap(lap, classes);
  if (lap.inLap) return IN_LAP;
  if (lap.outLap) return OUT_LAP;
  if (!cls.forRate) return NEUTRALISED;
  return cls.forPace ? 'pace' : NOT_FOR_PACE;
}

/** Whether a lap of use `use` (`lapClassOf`) is a rate lap: a pace lap or one excluded as `notForPace`. */
const isRateUse = (use: LapUse | 'pace'): boolean => use === 'pace' || use === NOT_FOR_PACE;

/** Whether every corner's wear at the lap's start is known. */
const wearVisible = (lap: Lap): boolean =>
  lap.wearAtStartPct.fl.known && lap.wearAtStartPct.fr.known && lap.wearAtStartPct.rl.known && lap.wearAtStartPct.rr.known;

/** A lap's fuel at its start in kg: its own, or what stands in for a hidden value (`fuelResolver`). */
export type FuelOf = (lap: Lap) => Known<number>;

/**
 * The fuel of a lap (spec 4.1): its own `fuelAtStartKg` when known. Hidden (a rival under realism) in the race: our
 * car's fuel at the start of the same lap; past our car's last lap with fuel, that value minus our burn per lap since
 * (the median burn of our rate laps, else `fallbackBurnKgPerLap`). Outside the race a hidden load stays unknown.
 */
export function fuelResolver(o: {
  isRace: boolean;
  ourLaps: () => readonly Lap[];
  classes: LapClassOptions;
  rate: RateOptions;
  fallbackBurnKgPerLap: number;
}): FuelOf {
  let ours: ((lapNumber: number) => number | undefined) | undefined;
  const oursOf = (): ((lapNumber: number) => number | undefined) => {
    const byLap = new Map<number, number>();
    const burns: GainSample[] = [];
    let last: { lapNumber: number; kg: number } | undefined;
    for (const l of o.ourLaps()) {
      if (!l.fuelAtStartKg.known) continue;
      byLap.set(l.lapNumber, l.fuelAtStartKg.value);
      if (last === undefined || l.lapNumber > last.lapNumber) last = { lapNumber: l.lapNumber, kg: l.fuelAtStartKg.value };
      if (!l.fuelAtEndKg.known || !classifyLap(l, o.classes).forRate) continue;
      const burn = l.fuelAtStartKg.value - l.fuelAtEndKg.value;
      // a refuel is no negative burn
      if (burn >= 0) burns.push({ lap: l.lapNumber, gain: burn, at: l.completedAt });
    }
    const rate = perLapGainRate(burns, o.rate);
    const burnPerLap = rate.known ? rate.value.perLap : o.fallbackBurnKgPerLap;
    return (n) => byLap.get(n) ?? (last !== undefined && n > last.lapNumber ? last.kg - burnPerLap * (n - last.lapNumber) : undefined);
  };
  return (lap) => {
    if (lap.fuelAtStartKg.known || !o.isRace) return lap.fuelAtStartKg;
    const kg = (ours ??= oursOf())(lap.lapNumber);
    return kg === undefined ? lap.fuelAtStartKg : known(kg, lap.completedAt);
  };
}

/**
 * Every car's laps, one record per lap (C25, the domain's `addLaps`), by lap number: one pass over a list holding any
 * cars' laps. A lap number is an integer key, which an object lists in ascending order.
 */
export function lapsByCar(laps: readonly Lap[]): Map<CarId, LapRecord[]> {
  const out = new Map<CarId, LapRecord[]>();
  // the records are only read
  addLaps(emptyCurrentLaps(), laps as readonly LapRecord[]).forEach((byLap, car) => out.set(car as CarId, Object.values(byLap)));
  return out;
}

/**
 * A stint after the filter: its laps with their uses, the filter's posterior, its pace laps as the filter read them,
 * whether they are fuel-corrected, the basis and the wear rate per corner.
 */
export type FittedStint = {
  laps: DegradationLap[];
  state: FilterState;
  paceLaps: FilterLap[];
  fuelCorrected: boolean;
  basis: 'wear' | 'age';
  wearRatePctPerLap: Corners<Known<number>>;
};

/**
 * A stint's laps (oldest first) through the filter from `prior`: every pace lap is read, fuel-corrected
 * (`lapTimeMs − γ · fuelKg`, whole ms) when every pace lap's fuel is known (`fuelCorrected`), else on its lap time.
 * The basis is `wear` when the stint's wear is visible (a lap with every corner's start wear known), else `age`.
 */
export function fitLaps(laps: readonly Lap[], fuelOf: FuelOf, prior: FilterPrior, config: Config, classes: LapClassOptions, rate: RateOptions): FittedStint {
  const out: DegradationLap[] = [];
  // the rows of the pace laps, in the order the filter reads them
  const pace: DegradationLap[] = [];
  const rateLaps: Lap[] = [];
  let allFuel = true;
  let paceFuel = true;
  let basis: 'wear' | 'age' = 'age';
  for (const lap of laps) {
    const fuel = fuelOf(lap);
    const correctedMs: Known<Ms> = fuel.known ? known(Math.round(lap.lapTimeMs - config.gammaMsPerKg * fuel.value), lap.completedAt) : unknown(fuel.reason);
    const use = lapClassOf(lap, classes);
    const row: DegradationLap = { lapNumber: lap.lapNumber, tyreAge: lap.tyreAgeAtStart, lapTimeMs: lap.lapTimeMs, correctedMs, use: use === 'pace' ? 'used' : use };
    out.push(row);
    if (use === 'pace') {
      pace.push(row);
      if (!fuel.known) paceFuel = false;
    }
    if (isRateUse(use)) rateLaps.push(lap);
    if (!fuel.known) allFuel = false;
    if (basis === 'age' && wearVisible(lap)) basis = 'wear';
  }
  const fuelCorrected = pace.length > 0 ? paceFuel : allFuel;
  const paceLaps: FilterLap[] = pace.map((row) => ({
    lapNumber: row.lapNumber,
    tyreAge: row.tyreAge,
    ms: fuelCorrected && row.correctedMs.known ? row.correctedMs.value : row.lapTimeMs,
  }));
  const state = runFilter(paceLaps, prior, config);
  // the filter's uses are in the order of its laps
  state.laps.forEach((l, i) => {
    const row = pace[i];
    if (row !== undefined) row.use = l.use;
  });
  return { laps: out, state, paceLaps, fuelCorrected, basis, wearRatePctPerLap: wearRates(rateLaps, rate) };
}

/**
 * Per corner the wear rate in % per lap (`per-lap-rate`'s median gain over the rate laps, of which it reads the newest
 * `window`, so only those are sampled); a corner whose wear is hidden on every lap carries the reason it is hidden.
 */
function wearRates(rateLaps: readonly Lap[], rate: RateOptions): Corners<Known<number>> {
  const corner = (c: Corner): Known<number> => {
    const samples: GainSample[] = [];
    let hidden: Known<never> | undefined;
    for (let i = rateLaps.length - 1; i >= 0 && samples.length < rate.window; i--) {
      const l = rateLaps[i];
      if (l === undefined) continue;
      const start = l.wearAtStartPct[c];
      const end = l.wearAtEndPct[c];
      if (start.known && end.known) samples.push({ lap: l.lapNumber, gain: end.value - start.value, at: l.completedAt });
      else hidden ??= unknown(start.known ? (end.known ? 'notReceived' : end.reason) : start.reason);
    }
    if (samples.length === 0 && hidden !== undefined) return hidden;
    const r = perLapGainRate(samples.reverse(), rate);
    return r.known ? known(r.value.perLap, r.at) : r;
  };
  return { fl: corner('fl'), fr: corner('fr'), rl: corner('rl'), rr: corner('rr') };
}
