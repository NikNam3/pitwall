// One stint through `degradation`'s rules (spec 4.1), shared by the calculator and the priors (so a source's `lapUse`
// is the calculator's): each lap's use, its fuel correction, the filter over the pace laps, the basis and the wear rates.
import { addLaps, emptyCurrentLaps, known, unknown, type CarId, type Corners, type Known, type LapRecord, type LapUse, type Ms } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { isPaceLap, isRateLap, type LapClassOptions } from '../lap-classes/index.ts';
import { perLapGainRate, type GainSample, type RateOptions } from '../per-lap-rate/index.ts';
import { burnPerLapKg } from '../shared/fuel-burn.ts';
import type { DEGRADATION_CONFIG } from './config.ts';
import type { DegradationLap } from './types.ts';
import { runFilter, type FilterLap, type FilterPrior, type FilterState } from './kalman.ts';

type Lap = DeepReadonly<LapRecord>;
type Config = (typeof DEGRADATION_CONFIG)['defaults'];

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
  if (lap.inLap) return IN_LAP;
  if (lap.outLap) return OUT_LAP;
  // a pace lap is a rate lap: the common case asks once
  if (isPaceLap(lap, classes)) return 'pace';
  return isRateLap(lap, classes) ? NOT_FOR_PACE : NEUTRALISED;
}

/** Whether a lap of use `use` (`lapClassOf`) is a rate lap: a pace lap or one excluded as `notForPace`. */
const isRateUse = (use: LapUse | 'pace'): boolean => use === 'pace' || use === NOT_FOR_PACE;

/** Whether every corner's wear at the lap's start is known. */
const wearVisible = (lap: Lap): boolean =>
  lap.wearAtStartPct.fl.known && lap.wearAtStartPct.fr.known && lap.wearAtStartPct.rl.known && lap.wearAtStartPct.rr.known;

/** A lap's fuel at its start in kg: its own, or what stands in for a hidden value (`fuelResolver`). */
export type FuelOf = (lap: Lap) => Known<number>;

/**
 * The fuel of a lap (spec 4.1, C3, C8): its own `fuelAtStartKg` when known. A rival's load hidden by realism
 * (`unknown('realism')`) in the race: our car's fuel at the start of the same lap; past our car's last lap with fuel,
 * that value minus our burn per lap since (`burnPerLapKg`, `fuel`'s rate, C43; else `fallbackBurnKgPerLap`). Any other
 * unknown load (another reason, our own car's, or outside the race) stays unknown.
 */
export function fuelResolver(o: {
  isRace: boolean;
  ourCar: CarId;
  ourLaps: () => readonly Lap[];
  classes: LapClassOptions;
  rate: RateOptions;
  fallbackBurnKgPerLap: number;
}): FuelOf {
  let ours: ((lapNumber: number) => number | undefined) | undefined;
  const oursOf = (): ((lapNumber: number) => number | undefined) => {
    const laps = o.ourLaps();
    const byLap = new Map<number, number>();
    let last: { lapNumber: number; kg: number } | undefined;
    for (const l of laps) {
      if (!l.fuelAtStartKg.known) continue;
      byLap.set(l.lapNumber, l.fuelAtStartKg.value);
      if (last === undefined || l.lapNumber > last.lapNumber) last = { lapNumber: l.lapNumber, kg: l.fuelAtStartKg.value };
    }
    const burn = burnPerLapKg(laps, { lapClasses: o.classes, rate: o.rate });
    const burnPerLap = burn.known ? burn.value : o.fallbackBurnKgPerLap;
    return (n) => byLap.get(n) ?? (last !== undefined && n > last.lapNumber ? last.kg - burnPerLap * (n - last.lapNumber) : undefined);
  };
  return (lap) => {
    const own = lap.fuelAtStartKg;
    if (own.known || !o.isRace || own.reason !== 'realism' || lap.carId === o.ourCar) return own;
    const kg = (ours ??= oursOf())(lap.lapNumber);
    return kg === undefined ? own : known(kg, lap.completedAt);
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
 * A stint's laps (oldest first) through the filter from `prior`. The stint is fuel-corrected (`fuelCorrected`,
 * `lapTimeMs − γ · fuelKg` in whole ms) when one of its pace laps has a known fuel (one of its laps, without a pace lap):
 * then a pace lap whose fuel stays unknown (`fuelResolver`) is no pace lap of the fit (`notForPace`, C3). A stint where
 * none has is fitted on its lap times. The basis is `wear` when the stint's wear is visible (a lap with every corner's
 * start wear known), else `age`.
 */
export function fitLaps(laps: readonly Lap[], fuelOf: FuelOf, prior: FilterPrior, config: Config, classes: LapClassOptions, rate: RateOptions): FittedStint {
  const out: DegradationLap[] = [];
  // the rows of the pace laps and the laps as the filter reads them, in lap order: a lap's corrected time when its fuel
  // is known, else its lap time. A stint is corrected only if a pace lap's fuel is known, so in a stint that is not, every
  // pace lap reads its lap time; in one that is, only the pace laps without their fuel are left out (below).
  let fitted: DegradationLap[] = [];
  let paceLaps: FilterLap[] = [];
  const rateLaps: Lap[] = [];
  let anyFuel = false;
  let paceFuel = false;
  let paceUnfuelled = false;
  let basis: 'wear' | 'age' = 'age';
  for (const lap of laps) {
    const fuel = fuelOf(lap);
    const correctedMs: Known<Ms> = fuel.known ? known(Math.round(lap.lapTimeMs - config.gammaMsPerKg * fuel.value), lap.completedAt) : unknown(fuel.reason);
    const use = lapClassOf(lap, classes);
    const row: DegradationLap = { lapNumber: lap.lapNumber, tyreAge: lap.tyreAgeAtStart, lapTimeMs: lap.lapTimeMs, correctedMs, use: use === 'pace' ? 'used' : use };
    out.push(row);
    if (use === 'pace') {
      fitted.push(row);
      paceLaps.push({ lapNumber: row.lapNumber, tyreAge: row.tyreAge, ms: correctedMs.known ? correctedMs.value : row.lapTimeMs });
      if (fuel.known) paceFuel = true;
      else paceUnfuelled = true;
    }
    if (isRateUse(use)) rateLaps.push(lap);
    if (fuel.known) anyFuel = true;
    if (basis === 'age' && wearVisible(lap)) basis = 'wear';
  }
  const fuelCorrected = fitted.length > 0 ? paceFuel : anyFuel;
  // a corrected stint leaves its pace laps without their fuel out of the fit (`notForPace`)
  if (fuelCorrected && paceUnfuelled) {
    const kept = fitted.filter((row) => row.correctedMs.known);
    paceLaps = paceLaps.filter((_, i) => fitted[i]?.correctedMs.known === true);
    for (const row of fitted) if (!row.correctedMs.known) row.use = NOT_FOR_PACE;
    fitted = kept;
  }
  const state = runFilter(paceLaps, prior, config);
  // the filter's uses are in the order of its laps
  for (let i = 0; i < state.uses.length; i++) {
    const row = fitted[i];
    const use = state.uses[i];
    if (row !== undefined && use !== undefined) row.use = use;
  }
  return { laps: out, state, paceLaps, fuelCorrected, basis, wearRatePctPerLap: wearRates(rateLaps, rate) };
}

/** One corner's wear gains, newest first, and the reason the newest lap that hid its wear hid it. */
type CornerSamples = { samples: GainSample[]; hidden: Known<never> | undefined };

const cornerSamples = (): CornerSamples => ({ samples: [], hidden: undefined });

/** Adds a lap's sample of one corner (its start and end wear) unless the corner holds `window` samples already. */
function takeSample(acc: CornerSamples, start: DeepReadonly<Known<number>>, end: DeepReadonly<Known<number>>, lap: Lap, window: number): void {
  if (!(acc.samples.length < window)) return;
  if (start.known && end.known) acc.samples.push({ lap: lap.lapNumber, gain: end.value - start.value, at: lap.completedAt });
  else acc.hidden ??= unknown(start.known ? (end.known ? 'notReceived' : end.reason) : start.reason);
}

/** A corner's rate from its samples (`wearRates`). */
function cornerRate(acc: CornerSamples, rate: RateOptions): Known<number> {
  if (acc.samples.length === 0 && acc.hidden !== undefined) return acc.hidden;
  const r = perLapGainRate(acc.samples.reverse(), rate);
  return r.known ? known(r.value.perLap, r.at) : r;
}

/**
 * Per corner the wear rate in % per lap (`per-lap-rate`'s median gain over the rate laps, of which it reads the newest
 * `window`, so only those are sampled); a corner whose wear is hidden on every lap carries the reason it is hidden.
 */
function wearRates(rateLaps: readonly Lap[], rate: RateOptions): Corners<Known<number>> {
  const { window } = rate;
  const fl = cornerSamples();
  const fr = cornerSamples();
  const rl = cornerSamples();
  const rr = cornerSamples();
  // one pass from the newest lap, each corner by name, until every corner holds `window` samples
  const open = (): boolean => fl.samples.length < window || fr.samples.length < window || rl.samples.length < window || rr.samples.length < window;
  for (let i = rateLaps.length - 1; i >= 0 && open(); i--) {
    const l = rateLaps[i];
    if (l === undefined) continue;
    const start = l.wearAtStartPct;
    const end = l.wearAtEndPct;
    takeSample(fl, start.fl, end.fl, l, window);
    takeSample(fr, start.fr, end.fr, l, window);
    takeSample(rl, start.rl, end.rl, l, window);
    takeSample(rr, start.rr, end.rr, l, window);
  }
  return { fl: cornerRate(fl, rate), fr: cornerRate(fr, rate), rl: cornerRate(rl, rate), rr: cornerRate(rr, rate) };
}
