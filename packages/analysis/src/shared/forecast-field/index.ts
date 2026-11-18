// `forecast-field` (SP4.3a spec 6.1, C50): the only builder of the simulators' starting point, from an `AsOfView` and
// the estimation units' outputs. Not a unit: shared by `forecast-score` and the 4.3b analyses.
import {
  carStatusSpans,
  addLaps,
  emptyCurrentLaps,
  known,
  MINI_SECTORS,
  NOISE_COMPOUNDS,
  tyreIndex,
  unknown,
  type CarId,
  type CarNoise,
  type DriverNoise,
  type DrsZone,
  type ForecastSample,
  type FrameNumber,
  type Known,
  type LapRecord,
  type MiniSectorCrossing,
  type NoiseCompound,
  type RaceAssumptions,
  type RaceInteraction,
  type RivalStop,
  type RivalStops,
  type StartingPoint,
  type StartOption,
  type StintRecord,
  type TrackWetness,
  type TyreModelCar,
  type TyreModelCompound,
  type TyreModelOutput,
  type UnknownReason,
  type WeekendPace,
} from '@pitwall/domain';
import { projectionAsOf, runAsOf, type AsOfUnit, type AsOfView, type CalculatorId, type DeepReadonly } from '@pitwall/engine/readers';
import { degradationAsOf, degradationCalculator } from '../../degradation/calculator.ts';
import { DEGRADATION, DEGRADATION_CONFIG, type DegradationOutput } from '../../degradation/index.ts';
import { fuelResolver } from '../../degradation/stint-fit.ts';
import { driverNoiseCalculator } from '../../driver-noise/calculator.ts';
import { GAPS, type GapsOutput } from '../../gaps/index.ts';
import { DRIVER_NOISE, driverNoiseAsOf } from '../../driver-noise/index.ts';
import { classifyLap, LAP_CLASSES_CONFIG } from '../../lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../../per-lap-rate/index.ts';
import { pitLossCalculator } from '../../pit-loss/calculator.ts';
import { inLapSharePrior, PIT_LOSS, PIT_LOSS_CONFIG, pitLossAsOf, type PitLossOutput } from '../../pit-loss/index.ts';
import { raceInteractionCalculator } from '../../race-interaction/calculator.ts';
import { RACE_INTERACTION_CONFIG } from '../../race-interaction/config.ts';
import { RACE_INTERACTION, raceInteractionAsOf } from '../../race-interaction/index.ts';
import { rivalStopsCalculator } from '../../rival-stops/calculator.ts';
import { RIVAL_STOPS, rivalStopsAsOf } from '../../rival-stops/index.ts';
import { trackWetnessCalculator } from '../../track-wetness/calculator.ts';
import { TRACK_WETNESS, trackWetnessAsOf } from '../../track-wetness/index.ts';
import { tyreLifeCalculator } from '../../tyre-life/calculator.ts';
import { TYRE_LIFE, tyreLifeAsOf } from '../../tyre-life/index.ts';
import { tyreModelAsOf, tyreModelCalculator } from '../../tyre-model/calculator.ts';
import { TYRE_MODEL } from '../../tyre-model/id.ts';
import { worstWearRate } from '../../tyre-model/index.ts';
import { WEEKEND_PACE, weekendPaceAsOf, weekendPaceCalculator } from '../../weekend-pace/index.ts';
import { ourCars } from '@pitwall/domain';
import { startLapOf } from '../../race-forecast/index.ts';
import { configOf } from '../config-of.ts';
import { burnPerLapKg, planBurnKgPerLap } from '../fuel-burn.ts';
import { isHumanDriver } from '../human-driver.ts';
import { FORECAST_FIELD_CONFIG } from './config.ts';
import { lapModelParams } from './lap-model-params.ts';
import { distanceAsOf, distanceOf, leaderTimeAt, leaderTimes, newestCrossings, orderOf } from './placement.ts';

export * from './config.ts';
export { lapModelParams } from './lap-model-params.ts';

/**
 * The units whose as-of forms the starting point reads, as `runAsOf` runs them: degradation, weekend-pace, pit-loss,
 * track-wetness, tyre-model, tyre-life, driver-noise, rival-stops, race-interaction.
 */
export const FORECAST_UNITS: readonly AsOfUnit[] = [
  { id: DEGRADATION, reads: degradationCalculator.reads, asOf: degradationAsOf },
  { id: WEEKEND_PACE, reads: weekendPaceCalculator.reads, asOf: weekendPaceAsOf },
  { id: PIT_LOSS, reads: pitLossCalculator.reads, asOf: pitLossAsOf },
  { id: TRACK_WETNESS, reads: trackWetnessCalculator.reads, asOf: trackWetnessAsOf },
  { id: TYRE_MODEL, reads: tyreModelCalculator.reads, asOf: tyreModelAsOf },
  { id: TYRE_LIFE, reads: tyreLifeCalculator.reads, asOf: tyreLifeAsOf },
  { id: DRIVER_NOISE, reads: driverNoiseCalculator.reads, asOf: driverNoiseAsOf },
  { id: RIVAL_STOPS, reads: rivalStopsCalculator.reads, asOf: rivalStopsAsOf },
  { id: RACE_INTERACTION, reads: raceInteractionCalculator.reads, asOf: raceInteractionAsOf },
];

const isNoiseCompound = (c: string): c is NoiseCompound => (NOISE_COMPOUNDS as readonly string[]).includes(c);

/** Per car its newest lap's current record (C25: `addLaps` over the records of that lap number only). */
function newestLaps(laps: readonly LapRecord[], cars: number): (LapRecord | undefined)[] {
  const records: LapRecord[][] = [];
  for (const lap of laps) {
    if (lap.carId < 0 || lap.carId >= cars) continue;
    const own = records[lap.carId];
    if (own === undefined || lap.lapNumber > (own[0] as LapRecord).lapNumber) records[lap.carId] = [lap];
    else if (lap.lapNumber === (own[0] as LapRecord).lapNumber) own.push(lap);
  }
  return Array.from({ length: cars }, (_, id) => {
    const own = records[id];
    return own === undefined ? undefined : addLaps(emptyCurrentLaps(), own)[id]?.[(own[0] as LapRecord).lapNumber];
  });
}

/** The cars' status kinds from car-status's open spans (C17, C20), by slot. */
function statusOf(view: AsOfView): Map<CarId, string> {
  const out = new Map<CarId, string>();
  for (const span of view.situation.byMachine[carStatusSpans.machine] ?? []) if (span.carId !== undefined) out.set(span.carId, span.kind);
  return out;
}

/** Collects what a build lacks: a missing value makes the whole starting point unknown, never a 0 or `NaN` (C3). */
class Needs {
  reason: UnknownReason | undefined;
  of(k: DeepReadonly<Known<number>> | undefined, fallback?: number): number {
    if (k?.known === true) return k.value;
    if (fallback !== undefined) return fallback;
    this.reason ??= k?.known === false ? k.reason : 'insufficientData';
    return 0;
  }
}

/**
 * The starting point at `view`'s frame from the units' `outputs`. Each car is placed by its newest crossing and the
 * time since at its current pace. A live build (`gaps`' output among `outputs`, SP4.3c Task 13, O10) takes the order
 * and the gaps at the last common crossing from `gaps` and carries each gap forward to the view's time; an as-of build
 * extrapolates both from the crossings. Before the leader's lap 2 the grid start (`buildGridStart`, SP4.3d2 Task 7)
 * with the race's order, each car's fitted compound (`tyre-model`'s; unknown: drawn), nothing free. A car without a
 * green race lap of its own takes `weekend-pace`'s pace where it knows one (call 9). `notApplicable` outside the race.
 */
export function buildStartingPoint(view: AsOfView, outputs: ReadonlyMap<CalculatorId, unknown>): Known<StartingPoint> {
  if (view.situation.weekendPhase.kind !== 'race') return unknown('notApplicable');
  const fixed = view.fixed;
  if (!fixed.totalLaps.known) return unknown(fixed.totalLaps.reason);
  const at = view.at;
  const config = configOf(FORECAST_FIELD_CONFIG, view);

  // the session's cars: those car-status has in the session; a slot not in it counts as retired
  const status = statusOf(view);
  let cars = 0;
  for (const [id, kind] of status) if (kind !== 'absent') cars = Math.max(cars, id + 1);
  if (cars === 0) return unknown('notApplicable');
  const retired = new Uint8Array(cars);
  for (let k = 0; k < cars; k++) retired[k] = status.get(k as CarId) === 'competing' ? 0 : 1;

  const crossings = view.history.crossings as readonly MiniSectorCrossing[];
  const newest = newestCrossings(crossings, cars);
  const gaps = outputs.get(GAPS) as DeepReadonly<GapsOutput> | undefined;
  const order = gaps === undefined ? orderOf(newest, retired) : orderByGaps(gaps, orderOf(newest, retired), retired);
  const leader = order[0] as number;
  const leaderNewest = newest[leader];
  if (retired[leader] === 1) return unknown('notApplicable');
  const tyreModel = (outputs.get(TYRE_MODEL) as DeepReadonly<TyreModelOutput> | undefined) ?? {};
  // before the leader's lap 2 the race starts from the grid (SP4.3d2 Task 7): the race's order, each car on its fitted
  // compound where tyre-model knows it (a realism-hidden one drawn), nothing free
  if (leaderNewest === undefined || leaderNewest.lap < 2) {
    const grid = Array.from(order).filter((k) => retired[k] === 0) as CarId[];
    const fittedCompound = (car: CarId): Known<NoiseCompound> => (tyreModel[car]?.fittedCompound as Known<NoiseCompound> | undefined) ?? unknown('notReceived');
    const laps = fixed.totalLaps.value;
    return buildGridStart(view, outputs, { laps, grid, fittedCompound, race: { laps, sets: 'carried' } });
  }

  const laps = view.history.laps as readonly LapRecord[];
  const newestLap = newestLaps(laps, cars);
  const stintsByCar: StintRecord[][] = Array.from({ length: cars }, () => []);
  for (const s of view.history.stints as readonly StintRecord[]) if (s.carId >= 0 && s.carId < cars) stintsByCar[s.carId]?.push(s);

  const degradation = outputs.get(DEGRADATION) as DeepReadonly<DegradationOutput> | undefined;
  const noise = outputs.get(DRIVER_NOISE) as DeepReadonly<DriverNoise> | undefined;
  const stops = (outputs.get(RIVAL_STOPS) as DeepReadonly<RivalStops> | undefined) ?? {};
  const wetness = outputs.get(TRACK_WETNESS) as DeepReadonly<TrackWetness> | undefined;
  const pitLoss = outputs.get(PIT_LOSS) as DeepReadonly<PitLossOutput> | undefined;
  const interaction = outputs.get(RACE_INTERACTION) as RaceInteraction | undefined;
  const weekendPace = outputs.get(WEEKEND_PACE) as DeepReadonly<WeekendPace> | undefined;
  if (noise === undefined || interaction === undefined) return unknown('insufficientData');
  const lapModel = lapModelParams(view, outputs);
  const need = new Needs();
  const lapsByCar = byCar(laps, cars);
  const lapClasses = configOf(LAP_CLASSES_CONFIG, view);

  // a realism-hidden fuel load: degradation's rule (our car's at the same lap, C43)
  const player = fixed.playerCar;
  const degConfig = configOf(DEGRADATION_CONFIG, view);
  const fuelOf = fuelResolver({
    isRace: player.known,
    ourCar: player.known ? player.value : (-1 as CarId),
    ourLaps: () => (player.known ? laps.filter((l) => l.carId === player.value) : []),
    classes: { isRace: true, ...configOf(LAP_CLASSES_CONFIG, view) },
    rate: configOf(PER_LAP_RATE_CONFIG, view),
    fallbackBurnKgPerLap: degConfig.fallbackBurnKgPerLap,
  });

  const lapsTotal = fixed.totalLaps.value;
  // a start inside the race (the grid start: `buildGridStart`)
  const sp = allocated(view, { lap: leaderNewest.lap, lapsTotal, cars, order, retired, interaction, lapModel, wetness, pitLoss, need, start: null });
  // the declared stand-ins (C3, final review F4): an unknown compound's, an unknown driver's; a car without a lap takes
  // degradation's field stand-in (SP4.3c Task 13, R47, C43: which car's lap stands in is degradation's): its pace, and
  // the compound, tyre age and lap record of the car it names (`fromCarId`)
  const unknownCompound = unknownCompoundOf(config);
  const stintsBy = degradation?.stints ?? {};
  const standIn = degradation?.standIn.known === true ? degradation.standIn.value : undefined;
  const standInLap: LapRecord | undefined = standIn === undefined ? undefined : newestLap[standIn.fromCarId];

  const lapMs = new Float64Array(cars);
  for (let k = 0; k < cars; k++) {
    const id = k as CarId;
    // a car without a completed lap (lap 1 not yet done) runs on the stand-in car's newest lap; without a stand-in a
    // running car makes the build unknown (C3), a retired car is not run
    const own = newestLap[k];
    const lap = own ?? standInLap;
    if (lap === undefined) {
      if (retired[k] === 0) need.of(unknown('insufficientData'));
      sp.compound[k] = NOISE_COMPOUNDS.indexOf(unknownCompound);
      continue;
    }
    // just stopped (on its in lap, or a stint closed on its newest lap): a fresh set; the old compound stands in until
    // its out lap is recorded
    const stopped = own !== undefined && (own.inLap || (stintsByCar[k] ?? []).some((s) => s.lastLap >= own.lapNumber));
    const compound: NoiseCompound = isNoiseCompound(lap.visualCompound) ? lap.visualCompound : unknownCompound;
    sp.compound[k] = NOISE_COMPOUNDS.indexOf(compound);
    const tyreAge = stopped ? 0 : own === undefined ? lap.tyreAgeAtStart : lap.tyreAgeAtStart + 1;
    sp.tyreAge[k] = tyreAge;

    const carNoise = noise.cars[id] as DeepReadonly<CarNoise> | undefined;
    const driver = carNoise?.driver ?? 'unknown';
    sp.human[k] = isHumanDriver(driver === 'unknown' ? undefined : driver, config.unknownDriverIsHuman) ? 1 : 0;
    // the tyre terms are `tyre-model`'s, per compound (SP4.3c Task 12): the rate at the worst corner
    const model = tyreModel[id];
    const termsOf = (c: NoiseCompound) => model?.compounds[c];
    const rateOf = (c: NoiseCompound): number => need.of(worstOrUndefined(termsOf(c)));
    const rate = rateOf(compound);
    // wear: the worst corner where every corner is visible, else tyre age × the car's wear rate (realism, C8)
    const w = lap.wearAtEndPct;
    sp.wearPct[k] = stopped ? 0 : own !== undefined && w.fl.known && w.fr.known && w.rl.known && w.rr.known ? Math.max(w.fl.value, w.fr.value, w.rl.value, w.rr.value) : tyreAge * rate;
    // pace on the reference compound (the lap model adds the compound's offset): `degradation`'s base pace alone (O2,
    // SP4.3c Task 13: its fit or its newest lap; for a car without a lap the field's stand-in); a running car without
    // one makes the build unknown (C3), a retired car is not run
    const stints = stintsBy[id] ?? [];
    const paced = [...stints].reverse().find((s) => s.basePaceMs.known);
    let fuelIncluded = false;
    // a car without a green race lap of its own (call 9): `weekend-pace`'s pace where it knows one (fuel-free, on the
    // reference compound), else the rules below as before
    const early = weekendPace?.[id];
    if (early?.known === true && !(lapsByCar[k] ?? []).some((l) => classifyLap(l, { isRace: true, ...lapClasses }).forBands)) {
      sp.paceMs[k] = early.value.paceMs;
      sp.paceSdMs[k] = early.value.sdMs;
    } else if (paced !== undefined && paced.basePaceMs.known) {
      sp.paceMs[k] = paced.basePaceMs.value - offsetOf(lapModel.compoundOffsetMs, paced.visual);
      sp.paceSdMs[k] = paced.cov.known ? Math.sqrt(Math.max(0, paced.cov.value[0][0])) : config.fallbackPaceSdMs;
      fuelIncluded = paced.fuelIncluded;
    } else if (own === undefined && standIn !== undefined) {
      sp.paceMs[k] = standIn.basePaceMs - offsetOf(lapModel.compoundOffsetMs, standIn.compound);
      sp.paceSdMs[k] = config.fallbackPaceSdMs;
      fuelIncluded = standIn.fuelIncluded;
    } else if (retired[k] === 0) need.of(unknown('insufficientData'));
    // fuel at the end of the lap: as the fuel at the start of the next (degradation's rule for a hidden load); a base
    // pace that holds the car's fuel (`fuelIncluded`, B9) gets no fuel term on top: the lap model's fuel is 0
    if (fuelIncluded) sp.fuelKg[k] = 0;
    else sp.fuelKg[k] = own === undefined ? need.of(fuelOf(lap)) : need.of(fuelOf({ ...own, lapNumber: own.lapNumber + 1, fuelAtStartKg: own.fuelAtEndKg }));
    // ν's sd per lap is degradation's (its current stint's posterior, else its default), per % of wear on each compound
    const current = stints.at(-1);
    const nuSd = current === undefined ? degConfig.defaultNuSdMs : current.cov.known ? Math.sqrt(Math.max(0, current.cov.value[1][1])) : need.of(current.nuSdMs);
    tyreTermsInto(sp, k, model, nuSd, need, compound, rate);
    // the fitted set's laps to the 70 % limit (tyre-model's, floored; at or past it 0); −1 while unknown
    const fittedLimit = model?.fittedLapsToLimit;
    sp.fittedLapsToLimit[k] = fittedLimit?.known === true ? Math.max(0, Math.floor(fittedLimit.value)) : -1;
    noiseInto(sp, k, carNoise, noise, need);
    stopInto(sp, k, stops[id], stops[id]?.window.known === true ? stops[id].window.value : undefined, config.assumeOwesStop);

    lapMs[k] = lap.lapTimeMs;
  }
  if (need.reason !== undefined) return unknown(need.reason);

  // where the cars are "as of" the frame: each car moved on from its newest crossing at its newest lap's pace
  const distances = newest.map((c, k) => distanceAsOf(c, at, lapMs[k] as number, retired[k] === 1));
  // the leader's times back to the rearmost running car (a retired car's gap is measured from the nearest time kept)
  const rearmost = Math.min(...distances.filter((_, k) => retired[k] === 0));
  const times = leaderTimes(crossings, leader as CarId, Math.floor(rearmost), distanceOf(leaderNewest));
  const present = gaps === undefined ? undefined : gapsAtCrossing(gaps, lapMs[leader] as number);
  for (let k = 0; k < cars; k++) {
    const d = distances[k] as number;
    sp.lapFraction[k] = (d % MINI_SECTORS) / MINI_SECTORS;
    const t = leaderTimeAt(times, d);
    const own = retired[k] === 0 ? present?.get(k as CarId) : undefined;
    const c = newest[k];
    const tc = c === undefined ? undefined : leaderTimeAt(times, distanceOf(c));
    if (own !== undefined && c !== undefined) {
      // a live build: gaps' gap at the last common crossing, carried forward to the view's time (a forecast step): the
      // gap now as the crossings extrapolate it less the gap at the car's newest crossing
      sp.gapMs[k] = own + (t === undefined || tc === undefined ? 0 : at - t - (c.at - tc));
    } else sp.gapMs[k] = t === undefined ? 0 : Math.max(0, at - t);
  }

  // the burn the simulators use (O15): the car's measured burn, else its fuel over its whole laps left from where it
  // starts (a whole count: the as-of and the live builds differ only in lap fraction and gap)
  const burnOptions = { lapClasses, rate: configOf(PER_LAP_RATE_CONFIG, view) };
  for (let k = 0; k < cars; k++) {
    sp.fuelBurnKgPerLap[k] = planBurnKgPerLap(burnPerLapKg(lapsByCar[k] ?? [], burnOptions), sp.fuelKg[k] ?? 0, lapsTotal - startLapOf(sp, k) + 1);
  }

  sp.sets = setsOf(view, tyreModel, cars);
  const w = view.fixed.weatherNow;
  sp.weather = weatherOf(w?.forecast, w?.forecastAccuracy, view.at, sp.lap, lapsTotal, sp.lapFraction[leader] ?? 0, lapMs[leader] ?? 0);
  return known(sp, at);
}

/** What the grid start needs beyond the view (SP4.3d2 Task 7): the race's laps, the grid, each car's start compound. */
export type GridStartOptions = {
  /** The race's laps (the entered ones in the planning round, the race's own on its grid). */
  laps: number;
  /** The cars on the grid, pole first; a car slot not on it is not run (retired). */
  grid: readonly CarId[];
  /** A car's start compound: known (fitted), `'free'` (our cars in the planning round: the policy's) or unknown (drawn). */
  fittedCompound: (car: CarId) => Known<NoiseCompound> | 'free';
  /**
   * The race assumptions (C62d, SP4.3e Task 3): outside the race, `sets` says whether our cars race on the qualifying's
   * sets carried over or on a fresh allocation (`raceSetsOf`); in the race the builder reads the race's own sets.
   */
  race: RaceAssumptions;
};

/** The dry compounds a rival's start compound is drawn from (`rivalStartOdds*`). */
const START_COMPOUNDS = ['soft', 'medium', 'hard'] as const satisfies readonly NoiseCompound[];

/**
 * The race's starting point on the grid (SP4.3d2 Task 7, spec §7.2; the one builder, C50): lap 1, the cars in `grid`'s
 * order, each `gridGapMsPerPlace` per place behind the leader, at the line; every car on a fresh set with the fuel for
 * the race's laps at the shared burn (`planBurnKgPerLap`, C43: its measured burn, else our car's, else degradation's
 * fallback); a `'free'` car's start compound its policy's (`start.freeCompound`), an unknown one's drawn from
 * `start.odds` (the config's `rivalStartOdds*` restricted to the compounds it has a fresh set of where `tyre-model`
 * shows its sets, each with `rival-stops`' `byStartCompound` window); each car's pace from `weekend-pace` (C43), else
 * degradation's stand-in, else the build is `unknown('insufficientData')` (C3); the weather the race's forecast
 * (qualifying's `nextForecast`, the race's own on its grid) mapped onto laps by the grid leader's pace.
 */
export function buildGridStart(view: AsOfView, outputs: ReadonlyMap<CalculatorId, unknown>, opts: GridStartOptions): Known<StartingPoint> {
  const lapsTotal = opts.laps;
  if (!(lapsTotal > 0) || opts.grid.length === 0) return unknown('insufficientData');
  const config = configOf(FORECAST_FIELD_CONFIG, view);
  const noise = outputs.get(DRIVER_NOISE) as DeepReadonly<DriverNoise> | undefined;
  const interaction = outputs.get(RACE_INTERACTION) as RaceInteraction | undefined;
  if (noise === undefined || interaction === undefined) return unknown('insufficientData');
  const degradation = outputs.get(DEGRADATION) as DeepReadonly<DegradationOutput> | undefined;
  const stops = (outputs.get(RIVAL_STOPS) as DeepReadonly<RivalStops> | undefined) ?? {};
  const tyreModel = (outputs.get(TYRE_MODEL) as DeepReadonly<TyreModelOutput> | undefined) ?? {};
  const pace = (outputs.get(WEEKEND_PACE) as DeepReadonly<WeekendPace> | undefined) ?? {};

  // the session's slots (car-status's, C17) and the grid's; a slot not on the grid is not run
  let cars = 0;
  for (const [id, kind] of statusOf(view)) if (kind !== 'absent') cars = Math.max(cars, id + 1);
  for (const k of opts.grid) cars = Math.max(cars, k + 1);
  const onGrid = new Set<number>(opts.grid);
  const retired = new Uint8Array(cars);
  for (let k = 0; k < cars; k++) retired[k] = onGrid.has(k) ? 0 : 1;
  const order = Int8Array.from([...opts.grid, ...Array.from({ length: cars }, (_, k) => k).filter((k) => !onGrid.has(k))]);

  const need = new Needs();
  const lapModel = lapModelParams(view, outputs);
  const freeCompound = new Uint8Array(cars);
  const odds: (StartOption[] | null)[] = Array.from({ length: cars }, () => null);
  const sp = allocated(view, {
    lap: 1,
    lapsTotal,
    cars,
    order,
    retired,
    interaction,
    lapModel,
    wetness: outputs.get(TRACK_WETNESS) as DeepReadonly<TrackWetness> | undefined,
    pitLoss: outputs.get(PIT_LOSS) as DeepReadonly<PitLossOutput> | undefined,
    need,
    start: { freeCompound, odds },
  });

  const unknownCompound = unknownCompoundOf(config);
  const standIn = degradation?.standIn.known === true ? degradation.standIn.value : undefined;
  const degConfig = configOf(DEGRADATION_CONFIG, view);
  // the fuel: the car's measured burn, else our car's (degradation's rule for a hidden load, C43), else the fallback
  const burnOptions = { lapClasses: configOf(LAP_CLASSES_CONFIG, view), rate: configOf(PER_LAP_RATE_CONFIG, view) };
  const lapsByCar = byCar(view.history.laps as readonly LapRecord[], cars);
  const player = view.fixed.playerCar;
  const ourBurn = player.known && player.value < cars ? burnPerLapKg(lapsByCar[player.value] ?? [], burnOptions) : unknown('notApplicable');
  const oddsConfig: Record<(typeof START_COMPOUNDS)[number], number> = { soft: config.rivalStartOddsSoft, medium: config.rivalStartOddsMedium, hard: config.rivalStartOddsHard };

  opts.grid.forEach((id, place) => {
    const k = id as number;
    sp.gapMs[k] = place * config.gridGapMsPerPlace;
    const model = tyreModel[id];
    const stop = stops[id];
    const fitted = opts.fittedCompound(id);
    // the start compound: fitted, free (the policy's; the stand-in compound until then) or drawn (its likeliest option)
    let compound: NoiseCompound = unknownCompound;
    if (fitted === 'free') freeCompound[k] = 1;
    else if (fitted.known) compound = fitted.value;
    else {
      const options = startOptionsOf(oddsConfig, model, stop, lapsTotal);
      odds[k] = options;
      compound = options.reduce((best, o) => (o.p > best.p ? o : best), options[0] as StartOption).compound;
    }
    sp.compound[k] = NOISE_COMPOUNDS.indexOf(compound);

    const carNoise = noise.cars[id] as DeepReadonly<CarNoise> | undefined;
    const driver = carNoise?.driver ?? 'unknown';
    sp.human[k] = isHumanDriver(driver === 'unknown' ? undefined : driver, config.unknownDriverIsHuman) ? 1 : 0;

    // pace on the reference compound, fuel-free: weekend-pace's (C43), else degradation's field stand-in (C3)
    const own = pace[id];
    let fuelIncluded = false;
    if (own?.known === true) {
      sp.paceMs[k] = own.value.paceMs;
      sp.paceSdMs[k] = own.value.sdMs;
    } else if (standIn !== undefined) {
      sp.paceMs[k] = standIn.basePaceMs - offsetOf(lapModel.compoundOffsetMs, standIn.compound);
      sp.paceSdMs[k] = config.fallbackPaceSdMs;
      fuelIncluded = standIn.fuelIncluded;
    } else need.of(unknown('insufficientData'));

    const measured = burnPerLapKg(lapsByCar[k] ?? [], burnOptions);
    const burn = planBurnKgPerLap(measured.known ? measured : ourBurn, lapsTotal * degConfig.fallbackBurnKgPerLap, lapsTotal);
    sp.fuelBurnKgPerLap[k] = burn;
    // a base pace that holds the car's fuel (`fuelIncluded`, B9) gets no fuel term on top
    sp.fuelKg[k] = fuelIncluded ? 0 : lapsTotal * burn;

    // a fresh set: age 0, no wear, the compound's laps to the limit; ν's sd degradation's default (no stint yet)
    tyreTermsInto(sp, k, model, degConfig.defaultNuSdMs, need);
    sp.fittedLapsToLimit[k] = fitted !== 'free' && fitted.known ? (sp.tyre.lapsToLimit[tyreIndex(k, sp.compound[k] as number)] ?? -1) : -1;
    noiseInto(sp, k, carNoise, noise, need);
    stopInto(sp, k, stop, windowOn(stop, fitted !== 'free' && fitted.known ? compound : undefined), config.assumeOwesStop);
  });
  for (let k = 0; k < cars; k++) if (retired[k] === 1) sp.compound[k] = NOISE_COMPOUNDS.indexOf(unknownCompound);
  if (need.reason !== undefined) return unknown(need.reason);
  // where the cars are: the leader at the line, each car behind it its gap at its pace short of the line (the lap
  // before, as `startLapOf` reads a lap fraction past the leader's), so the forecast plays each car's laps 1 … laps
  for (const id of opts.grid.slice(1)) {
    const k = id as number;
    const lapMs = sp.paceMs[k] ?? 0;
    const short = lapMs > 0 ? (sp.gapMs[k] ?? 0) / lapMs : 0;
    sp.lapFraction[k] = short > 0 && short < 1 ? 1 - short : 0;
  }

  sp.sets = raceSetsOf(view, tyreModel, cars, opts.race);
  // the race's forecast: in qualifying the next session's samples (spec §7.3), on the race's grid its own
  const w = view.fixed.weatherNow;
  const samples = view.situation.weekendPhase.kind === 'race' ? w?.forecast : w?.nextForecast;
  sp.weather = weatherOf(samples, w?.forecastAccuracy, view.at, 1, lapsTotal, 0, sp.paceMs[opts.grid[0] as number] ?? 0);
  return known(sp, view.at);
}

/** A car's first stop window on `compound` (`rival-stops`' `byStartCompound`), else its window, else none (`stopInto`'s rule). */
function windowOn(stop: DeepReadonly<RivalStop> | undefined, compound: NoiseCompound | undefined): DeepReadonly<Window> | undefined {
  const on = compound === undefined ? undefined : stop?.byStartCompound?.[compound];
  if (on !== undefined) return on;
  return stop?.window.known === true ? stop.window.value : undefined;
}

/**
 * A rival's start options on the grid: the config's chances (`odds`) of the compounds it has a fresh set of, where
 * `tyre-model` shows its sets (a compound whose count is unknown is kept); without any, the compounds it has a fresh set
 * of, evenly; without those, the config's chances as they are. Each option with its first stop's window on it
 * (`windowOn`; the uninformative one from lap 2 to the flag without either). The chances sum to 1.
 */
function startOptionsOf(odds: Record<(typeof START_COMPOUNDS)[number], number>, model: DeepReadonly<TyreModelCar> | undefined, stop: DeepReadonly<RivalStop> | undefined, lapsTotal: number): StartOption[] {
  const fresh = model?.freshSets;
  const hasSet = (c: NoiseCompound): boolean => fresh === undefined || !fresh[c].known || fresh[c].value > 0;
  const visibleSet = (c: NoiseCompound): boolean => fresh !== undefined && fresh[c].known && fresh[c].value > 0;
  let chances = START_COMPOUNDS.filter((c) => odds[c] > 0 && hasSet(c)).map((c) => [c, odds[c]] as const);
  if (chances.length === 0) chances = START_COMPOUNDS.filter(visibleSet).map((c) => [c, 1] as const);
  if (chances.length === 0) chances = START_COMPOUNDS.filter((c) => odds[c] > 0).map((c) => [c, odds[c]] as const);
  if (chances.length === 0) chances = START_COMPOUNDS.map((c) => [c, 1] as const);
  const total = chances.reduce((s, [, p]) => s + p, 0);
  return chances.map(([compound, p]) => {
    const w = windowOn(stop, compound) ?? (stop === undefined ? { lowLap: lapsTotal, midLap: lapsTotal, highLap: lapsTotal } : openWindow(1, lapsTotal));
    return { compound, p: p / total, stopLow: w.lowLap, stopMid: w.midLap, stopHigh: w.highLap };
  });
}

/** The compound an unknown visual compound stands in with (the config's, a noise compound; else its default). */
function unknownCompoundOf(config: (typeof FORECAST_FIELD_CONFIG)['defaults']): NoiseCompound {
  return isNoiseCompound(config.unknownCompound) ? config.unknownCompound : (FORECAST_FIELD_CONFIG.defaults.unknownCompound as NoiseCompound);
}

/** The parts of a starting point its builder decides; `allocated` fills the rest with zeros and the shared terms. */
type Frame = Pick<StartingPoint, 'lap' | 'lapsTotal' | 'cars' | 'order' | 'retired' | 'interaction' | 'lapModel' | 'start'> & {
  wetness: DeepReadonly<TrackWetness> | undefined;
  pitLoss: DeepReadonly<PitLossOutput> | undefined;
  need: Needs;
};

/**
 * A starting point of `f.cars` cars, every per-car term 0 (no limit known: −1; no odds or switch: null) for its builder
 * to fill; the wetness (track-wetness's), the track (`trackOf`, its missing terms through `f.need`), the one DRS rule
 * (race-interaction's, F7); the weather unknown until the cars are placed (`weatherOf`).
 */
function allocated(view: AsOfView, f: Frame): StartingPoint {
  const { cars } = f;
  const config = configOf(FORECAST_FIELD_CONFIG, view);
  const drsConfig = configOf(RACE_INTERACTION_CONFIG, view);
  const f64 = (): Float64Array => new Float64Array(cars);
  return {
    lap: f.lap,
    lapsTotal: f.lapsTotal,
    cars,
    order: f.order,
    gapMs: f64(),
    lapFraction: f64(),
    retired: f.retired,
    human: new Uint8Array(cars),
    compound: new Uint8Array(cars),
    tyreAge: new Int16Array(cars),
    wearPct: f64(),
    fuelKg: f64(),
    fuelBurnKgPerLap: f64(),
    paceMs: f64(),
    paceSdMs: f64(),
    sigmaMs: f64(),
    rho: f64(),
    mistakeRate: f64(),
    mistakeMedianMs: f64(),
    mistakeSigmaLog: f64(),
    bigEventRate: f64(),
    retireRate: f64(),
    tyre: {
      wearRatePct: new Float64Array(cars * NOISE_COMPOUNDS.length),
      degMsPerLap: new Float64Array(cars * NOISE_COMPOUNDS.length),
      degSdMs: new Float64Array(cars * NOISE_COMPOUNDS.length),
      lapsToLimit: new Int16Array(cars * NOISE_COMPOUNDS.length).fill(-1),
    },
    stopLow: new Int16Array(cars),
    stopMid: new Int16Array(cars),
    stopHigh: new Int16Array(cars),
    owesStop: new Uint8Array(cars),
    fittedLapsToLimit: new Int16Array(cars).fill(-1),
    nextOdds: Array.from({ length: cars }, () => null),
    typeSwitch: Array.from({ length: cars }, () => null),
    sets: {},
    wetness: wetnessOf(f.wetness, config.priorWetnessSdMs),
    weather: unknown('notReceived'),
    track: trackOf(view, f.pitLoss, f.need, inLapSharePrior(view.track, configOf(PIT_LOSS_CONFIG, view).inLapShare)),
    drs: { rangeMs: drsConfig.drsRangeMs, fromLap: drsConfig.drsFromLap },
    interaction: f.interaction,
    lapModel: f.lapModel,
    start: f.start,
  };
}

/** Per car slot `0 … cars - 1` its records of `laps`, in their order. */
function byCar(laps: readonly LapRecord[], cars: number): LapRecord[][] {
  const out: LapRecord[][] = Array.from({ length: cars }, () => []);
  for (const l of laps) if (l.carId >= 0 && l.carId < cars) out[l.carId]?.push(l);
  return out;
}

/**
 * Car `k`'s tyre terms from `tyre-model`, each compound its own (after a stop the car runs on the new compound's,
 * `tyreIndex`): the wear rate at the worst corner, the loss per % of wear, ν's sd (`nuSd`) per % of wear, a fresh set's
 * laps to the limit; `compound`'s rate `rate` where the caller has it already.
 */
function tyreTermsInto(sp: StartingPoint, k: number, model: DeepReadonly<TyreModelCar> | undefined, nuSd: number, need: Needs, compound?: NoiseCompound, rate?: number): void {
  for (let i = 0; i < NOISE_COMPOUNDS.length; i++) {
    const c = NOISE_COMPOUNDS[i] as NoiseCompound;
    const t = tyreIndex(k, i);
    const terms = model?.compounds[c];
    const r = c === compound && rate !== undefined ? rate : need.of(worstOrUndefined(terms));
    sp.tyre.wearRatePct[t] = r;
    sp.tyre.degMsPerLap[t] = need.of(terms?.lossMsPerPct.value);
    sp.tyre.degSdMs[t] = r > 0 ? nuSd / r : 0;
    const limit = terms?.lapsToLimit;
    sp.tyre.lapsToLimit[t] = limit?.known === true ? Math.floor(limit.value) : -1;
  }
}

/** Car `k`'s driver terms from `driver-noise` (the AI field's where the car's own is unknown). */
function noiseInto(sp: StartingPoint, k: number, carNoise: DeepReadonly<CarNoise> | undefined, noise: DeepReadonly<DriverNoise>, need: Needs): void {
  sp.sigmaMs[k] = need.of(carNoise?.sigmaMs);
  sp.rho[k] = need.of(carNoise?.rho);
  sp.mistakeRate[k] = need.of(carNoise?.mistakeRatePerLap, noise.aiField.mistakeRatePerLap.known ? noise.aiField.mistakeRatePerLap.value : undefined);
  const size = carNoise?.mistakeSize;
  if (size?.known === true) {
    sp.mistakeMedianMs[k] = size.value.medianMs;
    sp.mistakeSigmaLog[k] = size.value.sigmaLog;
  } else need.of(size === undefined ? undefined : unknown(size.reason));
  sp.bigEventRate[k] = need.of(carNoise?.bigEventRatePerLap, noise.aiField.bigEventRatePerLap.known ? noise.aiField.bigEventRatePerLap.value : undefined);
  sp.retireRate[k] = need.of(carNoise?.retireRatePerLap, noise.aiField.retireRatePerLap.known ? noise.aiField.retireRatePerLap.value : undefined);
}

/** A stop window as the starting point holds it. */
type Window = { lowLap: number; midLap: number; highLap: number };

/** The uninformative window: from the lap after `lap` to the flag. */
function openWindow(lap: number, lapsTotal: number): Window {
  const low = Math.min(lap + 1, lapsTotal);
  return { lowLap: low, midLap: Math.floor((low + lapsTotal) / 2), highLap: lapsTotal };
}

/**
 * Car `k`'s next stop (`rival-stops`): a car without an entry stops not before the flag; `window` its window, unknown
 * the uninformative one from the next lap to the flag; an unknown owesStop the config's assumption (C3, ruling R40);
 * its next compound's odds and its tyre-type switch from the game's delta (SP4.3c O9, O5), null while unknown.
 */
function stopInto(sp: StartingPoint, k: number, stop: DeepReadonly<RivalStop> | undefined, window: DeepReadonly<Window> | undefined, assumeOwesStop: boolean): void {
  const lapsTotal = sp.lapsTotal;
  const w = stop === undefined ? { lowLap: lapsTotal, midLap: lapsTotal, highLap: lapsTotal } : (window ?? openWindow(sp.lap, lapsTotal));
  sp.stopLow[k] = w.lowLap;
  sp.stopMid[k] = w.midLap;
  sp.stopHigh[k] = w.highLap;
  const owes = stop === undefined ? false : stop.owesStop.known ? stop.owesStop.value : assumeOwesStop;
  sp.owesStop[k] = owes ? 1 : 0;
  sp.nextOdds[k] = stop?.nextCompound.known === true ? { ...stop.nextCompound.value } : null;
  sp.typeSwitch[k] = stop?.switchLap.known === true && stop.switchTo.known ? { lap: stop.switchLap.value, to: stop.switchTo.value } : null;
}

/** The rain chance `min` minutes ahead, linearly between the samples around it (`samples` by offset, not empty). */
function rainPctAt(samples: readonly { offsetMin: number; rainPct: number }[], min: number): number {
  const first = samples[0] as (typeof samples)[number];
  if (min <= first.offsetMin) return first.rainPct;
  for (let i = 1; i < samples.length; i++) {
    const s1 = samples[i] as (typeof samples)[number];
    if (min > s1.offsetMin) continue;
    const s0 = samples[i - 1] as (typeof samples)[number];
    const span = s1.offsetMin - s0.offsetMin;
    return span > 0 ? s0.rainPct + ((min - s0.offsetMin) / span) * (s1.rainPct - s0.rainPct) : s1.rainPct;
  }
  return (samples[samples.length - 1] as (typeof samples)[number]).rainPct;
}

/**
 * The forecast mapped onto race laps by the leader's lap time (SP4.3b spec §7.1, S12): lap L (from the leader's lap
 * `lap` on) takes the rain chance at its middle, linearly between the two samples around it (SP4.3b Task 19c: one
 * sample per lap put a perfect forecast's changes 1.7–3 laps late on the game's 5/15/30-minute grid); a middle before
 * the first sample takes the first's, one past the last the last's. Only where the view holds the forecast now
 * (`weatherNow`, the now path, R19: `forecast` its samples, `accuracy` theirs); unknown otherwise (C3).
 */
function weatherOf(
  forecast: DeepReadonly<ForecastSample[]> | undefined,
  accuracy: 'perfect' | 'approximate' | undefined,
  at: number,
  lap: number,
  lapsTotal: number,
  leaderFraction: number,
  leaderLapMs: number,
): StartingPoint['weather'] {
  if (forecast === undefined || accuracy === undefined || forecast.length === 0) return unknown('notReceived');
  if (!(leaderLapMs > 0)) return unknown('insufficientData');
  const samples = [...forecast].sort((a, b) => a.offsetMin - b.offsetMin);
  const byLap: { lap: number; rainPct: number }[] = [];
  for (let l = lap; l <= lapsTotal; l++) {
    const inMin = ((l - lap + 0.5 - leaderFraction) * leaderLapMs) / 60_000;
    byLap.push({ lap: l, rainPct: rainPctAt(samples, inMin) });
  }
  return known({ byLap, accuracy }, at);
}

/**
 * A live build's order (SP4.3c Task 13, O10): the running cars `gaps` lists, in its order; then the running cars it does
 * not list and the retired cars last, each as `crossings` (the crossings' order) has them.
 */
function orderByGaps(gaps: DeepReadonly<GapsOutput>, crossings: Int8Array, retired: Uint8Array): Int8Array {
  const listed: number[] = [];
  for (const i of gaps.intervals) if (i.carId >= 0 && i.carId < retired.length && retired[i.carId] === 0 && !listed.includes(i.carId)) listed.push(i.carId);
  return Int8Array.from([...listed, ...Array.from(crossings).filter((k) => !listed.includes(k))]);
}

/**
 * Per car `gaps` lists with a known gap, its gap to the leader at the last crossing both passed; a lapped car's
 * (`lapsDown`) adds a lap of the leader's newest lap time per lap down (a forecast step, R34).
 */
function gapsAtCrossing(gaps: DeepReadonly<GapsOutput>, leaderLapMs: number): Map<CarId, number> {
  const out = new Map<CarId, number>();
  for (const i of gaps.intervals) if (i.toLeaderMs.known) out.set(i.carId, i.toLeaderMs.value + i.lapsDown * leaderLapMs);
  return out;
}

/** An offset of the lap model for a stint's visual compound (0 for one it does not tell apart). */
const offsetOf = (offsets: Record<NoiseCompound, number>, visual: string): number => (isNoiseCompound(visual) ? offsets[visual] : 0);

/** A compound's wear rate at its worst corner: `tyre-model`'s pick (R64); `undefined` without the compound's terms. */
const worstOrUndefined = (terms: DeepReadonly<TyreModelCompound> | undefined): Known<number> | undefined => (terms === undefined ? undefined : worstWearRate(terms));

/** The track's wetness (track-wetness's state); without a known state, the declared prior: dry with `priorSdMs` (C3, ruling R40). */
function wetnessOf(wetness: DeepReadonly<TrackWetness> | undefined, priorSdMs: number): StartingPoint['wetness'] {
  const state = wetness?.state;
  return state?.known === true ? { wetnessMs: state.value.wetnessMs, sdMs: state.value.sdMs, wet: wetness?.wet.known === true && wetness.wet.value } : { wetnessMs: 0, sdMs: priorSdMs, wet: false };
}

/**
 * The track: braking zones (their starts) and DRS zones from the track file, the pit loss per condition from pit-loss
 * (else the track file's default), and the in-lap's share of it: pit-loss's green share (SP4.3b Task 11c; a neutralised
 * stop is scored with its own loss, split by green's share), else pit-loss's prior `priorShare` (the track file's share,
 * else pit-loss's config's: `inLapSharePrior`, SP4.3b Task 26).
 */
function trackOf(view: AsOfView, pitLoss: DeepReadonly<PitLossOutput> | undefined, need: Needs, priorShare: number): StartingPoint['track'] {
  const inLapShare = need.of(pitLoss?.conditions.green.inLapShare, priorShare);
  const track = view.track.known ? view.track.value : undefined;
  const braking = track?.brakingZones.known === true ? track.brakingZones.value.map((z) => z.start) : [];
  const drs: DrsZone[] = track?.drsZones.known === true ? track.drsZones.value.map((z) => ({ detection: z.detection, start: z.start, end: z.end })) : [];
  const lossOf = (c: 'green' | 'vsc' | 'sc'): number => {
    const own = pitLoss?.conditions[c].lossMs;
    const fallback = track?.defaults.pitLossMs[c];
    return need.of(own, fallback?.known === true ? fallback.value.value : undefined);
  };
  return { brakingZones: Float64Array.from(braking), drsZones: drs, pitLossMs: { green: lossOf('green'), vsc: lossOf('vsc'), sc: lossOf('sc'), inLapShare } };
}

/** Our cars' sets left (the shared `ourCars` rule, C43): `tyre-model`'s used sets, where it knows them. */
function setsOf(view: AsOfView, tyreModel: DeepReadonly<TyreModelOutput>, cars: number): StartingPoint['sets'] {
  const out: StartingPoint['sets'] = {};
  for (const car of oursIn(view, cars)) {
    const used = tyreModel[car]?.usedSets;
    if (used === undefined || !used.known) continue;
    out[car] = used.value.map((s) => ({ compound: s.compound, wearPct: s.wearPct }));
  }
  return out;
}

/** Our cars in the view that are slots of a field of `cars` (the shared `ourCars` rule, C43). */
function oursIn(view: AsOfView, cars: number): CarId[] {
  const fixed = view.fixed;
  if (!fixed.playerCar.known) return [];
  const teammate = fixed.teammateCar.known ? fixed.teammateCar.value : undefined;
  return ourCars({ playerCar: fixed.playerCar.value, teammateCar: teammate }).filter((car) => car < cars);
}

/**
 * Our cars' race sets on a grid start (SP4.3e Task 3, spec §4.4 item 3; the one builder, C50): in the race, and with
 * `race.sets` `'carried'`, `tyre-model`'s sets (`setsOf`; availability is `tyre-model`'s, C43); with `'fresh'` outside
 * the race the config's `freshRaceSets*` per compound, every set new (C47).
 */
// SP4.3e Task 3: the carried race's reserved sets (`recommendedSession` the race's session type, R8d) wait on a
// requested `tyre-model` output and step-1 value (the weekend structure is a signal, C12, C13); see the task's report.
/**
 * Our cars' sets carried into the race from the qualifying: `tyre-model`'s `raceSets` (the sets available now and those
 * the game reserves for the next race, Task 3b; availability is tyre-model's, C43); a car without them gets none.
 */
function carriedSetsOf(view: AsOfView, tyreModel: DeepReadonly<TyreModelOutput>, cars: number): StartingPoint['sets'] {
  const out: StartingPoint['sets'] = {};
  for (const car of oursIn(view, cars)) {
    const sets = tyreModel[car]?.raceSets;
    if (sets === undefined || !sets.known) continue;
    out[car] = sets.value.map((s) => ({ compound: s.compound, wearPct: s.wearPct }));
  }
  return out;
}

function raceSetsOf(view: AsOfView, tyreModel: DeepReadonly<TyreModelOutput>, cars: number, race: RaceAssumptions): StartingPoint['sets'] {
  if (view.situation.weekendPhase.kind === 'race') return setsOf(view, tyreModel, cars);
  if (race.sets === 'carried') return carriedSetsOf(view, tyreModel, cars);
  const c = configOf(FORECAST_FIELD_CONFIG, view);
  const counts: Record<NoiseCompound, number> = { soft: c.freshRaceSetsSoft, medium: c.freshRaceSetsMedium, hard: c.freshRaceSetsHard, inter: c.freshRaceSetsInter, wet: c.freshRaceSetsWet };
  const fresh = NOISE_COMPOUNDS.flatMap((compound) => Array.from({ length: Math.max(0, Math.floor(counts[compound])) }, () => ({ compound, wearPct: 0 })));
  const out: StartingPoint['sets'] = {};
  for (const car of oursIn(view, cars)) out[car] = fresh.map((s) => ({ ...s }));
  return out;
}

/** The starting point as of `frame`: `view` cut with `projectionAsOf`, the `FORECAST_UNITS` run on it (`runAsOf`), then built. */
export function startingPointAt(view: AsOfView, frame: FrameNumber): Known<StartingPoint> {
  const cut = projectionAsOf({ history: view.history, situation: view.situation }, frame);
  const asOf: AsOfView = { ...view, history: cut.history, situation: cut.situation, frame };
  return buildStartingPoint(asOf, runAsOf(FORECAST_UNITS, asOf));
}
