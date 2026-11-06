// One stint through `degradation`'s rules (spec 4.1), shared by the calculator and the priors (so a source's `lapUse`
// is the calculator's): each lap's use, its fuel correction, the filter over the pace laps, the basis and the wear rates.
import { addLaps, emptyCurrentLaps, known, unknown, type CarId, type Corners, type Known, type LapRecord, type LapUse, type Ms } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { isPaceLap, isRateLap, type LapClassOptions } from '../lap-classes/index.ts';
import type { Rate, RateOptions } from '../per-lap-rate/index.ts';
import { burnPerLapKg } from '../shared/fuel-burn.ts';
import { wearBasis, wearRatePerCorner } from '../shared/wear-rate.ts';
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
    if (fuel.known) anyFuel = true;
    // the stint's basis: `wear` once any lap's start wear gives it (the shared rule, `wearBasis`)
    if (basis === 'age') basis = wearBasis(lap.wearAtStartPct);
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
  return { laps: out, state, paceLaps, fuelCorrected, basis, wearRatePctPerLap: wearRates(laps, classes, rate) };
}

/** Per corner the wear rate in % per lap of the stint's laps: the shared rule (`wearRatePerCorner`, C43), as a plain rate. */
function wearRates(laps: readonly Lap[], classes: LapClassOptions, rate: RateOptions): Corners<Known<number>> {
  const rates = wearRatePerCorner(laps, { lapClasses: classes, rate });
  const perLap = (r: Known<Rate>): Known<number> => (r.known ? known(r.value.perLap, r.at) : r);
  return { fl: perLap(rates.fl), fr: perLap(rates.fr), rl: perLap(rates.rl), rr: perLap(rates.rr) };
}
