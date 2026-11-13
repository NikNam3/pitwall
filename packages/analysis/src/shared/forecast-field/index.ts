// `forecast-field` (SP4.3a spec 6.1, C50): the only builder of the simulators' starting point, from an `AsOfView` and
// the estimation units' outputs. Not a unit: shared by `forecast-score` and the 4.3b analyses.
import {
  carStatusSpans,
  addLaps,
  emptyCurrentLaps,
  known,
  MINI_SECTORS,
  NOISE_COMPOUNDS,
  unknown,
  type CarId,
  type CarNoise,
  type DriverNoise,
  type DrsZone,
  type FrameNumber,
  type Known,
  type LapRecord,
  type MiniSectorCrossing,
  type NoiseCompound,
  type RaceInteraction,
  type RivalStops,
  type StartingPoint,
  type StintRecord,
  type TrackWetness,
  type UnknownReason,
} from '@pitwall/domain';
import { projectionAsOf, runAsOf, type AsOfUnit, type AsOfView, type CalculatorId, type DeepReadonly } from '@pitwall/engine/readers';
import { degradationAsOf, degradationCalculator } from '../../degradation/calculator.ts';
import { DEGRADATION, DEGRADATION_CONFIG, type DegradationOutput, type StintDegradation } from '../../degradation/index.ts';
import { fuelResolver } from '../../degradation/stint-fit.ts';
import { driverNoiseCalculator } from '../../driver-noise/calculator.ts';
import { DRIVER_NOISE, driverNoiseAsOf } from '../../driver-noise/index.ts';
import { LAP_CLASSES_CONFIG } from '../../lap-classes/index.ts';
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
import { ourCars } from '../our-cars.ts';
import { FORECAST_FIELD_CONFIG } from './config.ts';
import { lapModelParams } from './lap-model-params.ts';
import { distanceAsOf, distanceOf, leaderTimeAt, leaderTimes, newestCrossings, orderOf } from './placement.ts';

export * from './config.ts';
export { lapModelParams } from './lap-model-params.ts';

/**
 * The units whose as-of forms the starting point reads, as `runAsOf` runs them: degradation, pit-loss, tyre-life,
 * track-wetness, driver-noise, rival-stops, race-interaction.
 */
export const FORECAST_UNITS: readonly AsOfUnit[] = [
  { id: DEGRADATION, reads: degradationCalculator.reads, asOf: degradationAsOf },
  { id: PIT_LOSS, reads: pitLossCalculator.reads, asOf: pitLossAsOf },
  { id: TYRE_LIFE, reads: tyreLifeCalculator.reads, asOf: tyreLifeAsOf },
  { id: TRACK_WETNESS, reads: trackWetnessCalculator.reads, asOf: trackWetnessAsOf },
  { id: DRIVER_NOISE, reads: driverNoiseCalculator.reads, asOf: driverNoiseAsOf },
  { id: RIVAL_STOPS, reads: rivalStopsCalculator.reads, asOf: rivalStopsAsOf },
  { id: RACE_INTERACTION, reads: raceInteractionCalculator.reads, asOf: raceInteractionAsOf },
];

const configOf = <C extends object>(section: { key: string; defaults: C }, view: Pick<AsOfView, 'config'>): C =>
  ({ ...section.defaults, ...view.config[section.key] }) as C;

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
 * The starting point at `view`'s frame from the units' `outputs`; `progress` is the live frame's lap progress, else
 * each car is placed by its newest crossing and the time since at its current pace. `notApplicable` before lap 1 is
 * complete or outside the race.
 */
export function buildStartingPoint(
  view: AsOfView,
  outputs: ReadonlyMap<CalculatorId, unknown>,
  progress?: { lapFraction: number[]; gapMs: number[] },
): Known<StartingPoint> {
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
  const order = orderOf(newest, retired);
  const leader = order[0] as number;
  const leaderNewest = newest[leader];
  // before the leader has completed lap 1 there is no lap to start from
  if (retired[leader] === 1 || leaderNewest === undefined || leaderNewest.lap < 2) return unknown('notApplicable');

  const laps = view.history.laps as readonly LapRecord[];
  const newestLap = newestLaps(laps, cars);
  const standIn = newestLap[leader];
  if (standIn === undefined) return unknown('insufficientData');
  const stintsByCar: StintRecord[][] = Array.from({ length: cars }, () => []);
  for (const s of view.history.stints as readonly StintRecord[]) if (s.carId >= 0 && s.carId < cars) stintsByCar[s.carId]?.push(s);

  const degradation = (outputs.get(DEGRADATION) as DeepReadonly<DegradationOutput> | undefined) ?? {};
  const noise = outputs.get(DRIVER_NOISE) as DeepReadonly<DriverNoise> | undefined;
  const stops = (outputs.get(RIVAL_STOPS) as DeepReadonly<RivalStops> | undefined) ?? {};
  const wetness = outputs.get(TRACK_WETNESS) as DeepReadonly<TrackWetness> | undefined;
  const pitLoss = outputs.get(PIT_LOSS) as DeepReadonly<PitLossOutput> | undefined;
  const interaction = outputs.get(RACE_INTERACTION) as RaceInteraction | undefined;
  if (noise === undefined || interaction === undefined) return unknown('insufficientData');
  const lapModel = lapModelParams(view, outputs);
  const need = new Needs();

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
  const drsConfig = configOf(RACE_INTERACTION_CONFIG, view);
  const f64= (): Float64Array => new Float64Array(cars);
  const sp: StartingPoint = {
    lap: leaderNewest.lap,
    lapsTotal,
    cars,
    order,
    gapMs: f64(),
    lapFraction: f64(),
    retired,
    human: new Uint8Array(cars),
    compound: new Uint8Array(cars),
    tyreAge: new Int16Array(cars),
    wearPct: f64(),
    fuelKg: f64(),
    paceMs: f64(),
    paceSdMs: f64(),
    degMsPerLap: f64(),
    degSdMs: f64(),
    sigmaMs: f64(),
    rho: f64(),
    mistakeRate: f64(),
    mistakeMedianMs: f64(),
    mistakeSigmaLog: f64(),
    bigEventRate: f64(),
    retireRate: f64(),
    wearRatePct: f64(),
    stopLow: new Int16Array(cars),
    stopMid: new Int16Array(cars),
    stopHigh: new Int16Array(cars),
    owesStop: new Uint8Array(cars),
    sets: {},
    wetness: wetnessOf(wetness, config.priorWetnessSdMs),
    // filled once the cars are placed (`weatherOf`)
    weather: unknown('notReceived'),
    track: trackOf(view, pitLoss, need, inLapSharePrior(view.track, configOf(PIT_LOSS_CONFIG, view).inLapShare)),
    // the one DRS rule: race-interaction's (F7)
    drs: { rangeMs: drsConfig.drsRangeMs, fromLap: drsConfig.drsFromLap },
    interaction,
    lapModel,
  };

  // the declared stand-ins (C3, final review F4): an unknown compound's, a car without a lap's, an unknown driver's
  const unknownCompound: NoiseCompound = isNoiseCompound(config.unknownCompound) ? config.unknownCompound : (FORECAST_FIELD_CONFIG.defaults.unknownCompound as NoiseCompound);
  const noLap: LapRecord = { ...standIn, lapTimeMs: standIn.lapTimeMs + config.noLapStandInOffsetMs };

  const lapMs = new Float64Array(cars);
  for (let k = 0; k < cars; k++) {
    const id = k as CarId;
    // a car without a completed lap (lap 1 not yet done) takes the leader's newest lap as its stand-in (the config's)
    const own = newestLap[k];
    const lap = own ?? noLap;
    // just stopped (on its in lap, or a stint closed on its newest lap): a fresh set; the old compound stands in until
    // its out lap is recorded
    const stopped = own !== undefined && (own.inLap || (stintsByCar[k] ?? []).some((s) => s.lastLap >= own.lapNumber));
    const compound: NoiseCompound = isNoiseCompound(lap.visualCompound) ? lap.visualCompound : unknownCompound;
    sp.compound[k] = NOISE_COMPOUNDS.indexOf(compound);
    const tyreAge = stopped ? 0 : own === undefined ? lap.tyreAgeAtStart : lap.tyreAgeAtStart + 1;
    sp.tyreAge[k] = tyreAge;

    const carNoise = noise.cars[id] as DeepReadonly<CarNoise> | undefined;
    const driver = carNoise?.driver ?? 'unknown';
    sp.human[k] = driver === 'human' || (driver === 'unknown' && config.unknownDriverIsHuman) ? 1 : 0;
    const rate = Math.max(config.minWearRatePctPerLap, need.of(carNoise?.wearRatePctPerLap[compound], worstRate(degradation[id]?.at(-1))));
    sp.wearRatePct[k] = rate;
    // wear: the worst corner where every corner is visible, else tyre age × the car's wear rate (realism, C8)
    const w = lap.wearAtEndPct;
    sp.wearPct[k] = stopped ? 0 : own !== undefined && w.fl.known && w.fr.known && w.rl.known && w.rr.known ? Math.max(w.fl.value, w.fr.value, w.rl.value, w.rr.value) : tyreAge * rate;
    // fuel at the end of the lap: as the fuel at the start of the next (degradation's rule for a hidden load)
    sp.fuelKg[k] = own === undefined ? need.of(fuelOf(lap)) : need.of(fuelOf({ ...own, lapNumber: own.lapNumber + 1, fuelAtStartKg: own.fuelAtEndKg }));

    // pace on the reference compound (the lap model adds the compound's offset) and degradation per % wear (ruling R18)
    const stints = degradation[id] ?? [];
    const paced = [...stints].reverse().find((s) => s.basePaceMs.known);
    if (paced !== undefined && paced.basePaceMs.known) {
      sp.paceMs[k] = paced.basePaceMs.value - offsetOf(lapModel.compoundOffsetMs, paced.visual);
      sp.paceSdMs[k] = paced.cov.known ? Math.sqrt(Math.max(0, paced.cov.value[0][0])) : config.fallbackPaceSdMs;
    } else {
      const fuel = fuelOf(lap);
      sp.paceMs[k] = lap.lapTimeMs - (fuel.known ? lapModel.fuelMsPerKg * fuel.value : 0) - lapModel.compoundOffsetMs[compound];
      sp.paceSdMs[k] = config.fallbackPaceSdMs;
    }
    const current = stints.at(-1);
    const nu = current === undefined ? degConfig.defaultNuMsPerLap : need.of(current.nuMsPerLap);
    const nuSd = current === undefined ? degConfig.defaultNuSdMs : current.cov.known ? Math.sqrt(Math.max(0, current.cov.value[1][1])) : need.of(current.nuSdMs);
    sp.degMsPerLap[k] = nu / rate;
    sp.degSdMs[k] = nuSd / rate;

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

    // the next stop (rival-stops); a car without an entry stops not before the flag. An unknown window is the
    // uninformative one, from the next lap to the flag; an unknown owesStop the config's assumption (C3, ruling R40)
    const stop = stops[id];
    if (stop === undefined) {
      sp.stopLow[k] = lapsTotal;
      sp.stopMid[k] = lapsTotal;
      sp.stopHigh[k] = lapsTotal;
    } else if (stop.window.known) {
      sp.stopLow[k] = stop.window.value.lowLap;
      sp.stopMid[k] = stop.window.value.midLap;
      sp.stopHigh[k] = stop.window.value.highLap;
    } else {
      const low = Math.min(sp.lap + 1, lapsTotal);
      sp.stopLow[k] = low;
      sp.stopMid[k] = Math.floor((low + lapsTotal) / 2);
      sp.stopHigh[k] = lapsTotal;
    }
    const owes = stop === undefined ? false : stop.owesStop.known ? stop.owesStop.value : config.assumeOwesStop;
    sp.owesStop[k] = owes ? 1 : 0;

    lapMs[k] = lap.lapTimeMs;
  }
  if (need.reason !== undefined) return unknown(need.reason);

  // where the cars are: the live frame's lap progress, else "as of" the frame from the crossings
  if (progress !== undefined) {
    for (let k = 0; k < cars; k++) {
      sp.lapFraction[k] = progress.lapFraction[k] ?? 0;
      sp.gapMs[k] = progress.gapMs[k] ?? 0;
    }
  } else {
    const distances = newest.map((c, k) => distanceAsOf(c, at, lapMs[k] as number, retired[k] === 1));
    // the leader's times back to the rearmost running car (a retired car's gap is measured from the nearest time kept)
    const rearmost = Math.min(...distances.filter((_, k) => retired[k] === 0));
    const times = leaderTimes(crossings, leader as CarId, Math.floor(rearmost), distanceOf(leaderNewest));
    for (let k = 0; k < cars; k++) {
      const d = distances[k] as number;
      sp.lapFraction[k] = (d % MINI_SECTORS) / MINI_SECTORS;
      const t = leaderTimeAt(times, d);
      sp.gapMs[k] = t === undefined ? 0 : Math.max(0, at - t);
    }
  }

  sp.sets = setsOf(view, cars);
  sp.weather = weatherOf(view, sp.lap, lapsTotal, sp.lapFraction[leader] ?? 0, lapMs[leader] ?? 0);
  return known(sp, at);
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
 * (`weatherNow`, the now path, R19); unknown otherwise (C3).
 */
function weatherOf(view: AsOfView, lap: number, lapsTotal: number, leaderFraction: number, leaderLapMs: number): StartingPoint['weather'] {
  const weather = view.fixed.weatherNow;
  if (weather === null || weather.forecast.length === 0) return unknown('notReceived');
  if (!(leaderLapMs > 0)) return unknown('insufficientData');
  const samples = [...weather.forecast].sort((a, b) => a.offsetMin - b.offsetMin);
  const byLap: { lap: number; rainPct: number }[] = [];
  for (let l = lap; l <= lapsTotal; l++) {
    const inMin = ((l - lap + 0.5 - leaderFraction) * leaderLapMs) / 60_000;
    byLap.push({ lap: l, rainPct: rainPctAt(samples, inMin) });
  }
  return known({ byLap, accuracy: weather.forecastAccuracy }, view.at);
}

/** An offset of the lap model for a stint's visual compound (0 for one it does not tell apart). */
const offsetOf = (offsets: Record<NoiseCompound, number>, visual: string): number => (isNoiseCompound(visual) ? offsets[visual] : 0);

/** A stint's worst corner's wear rate, where every corner's is known; else none. */
function worstRate(stint: DeepReadonly<StintDegradation> | undefined): number | undefined {
  if (stint === undefined) return undefined;
  const { fl, fr, rl, rr } = stint.wearRatePctPerLap;
  return fl.known && fr.known && rl.known && rr.known ? Math.max(fl.value, fr.value, rl.value, rr.value) : undefined;
}

/** The track's wetness (track-wetness's state); without a known state, the declared prior: dry with `priorSdMs` (C3, ruling R40). */
function wetnessOf(wetness: DeepReadonly<TrackWetness> | undefined, priorSdMs: number): StartingPoint['wetness'] {
  const state = wetness?.state;
  return state?.known === true ? { wetnessMs: state.value.wetnessMs, sdMs: state.value.sdMs } : { wetnessMs: 0, sdMs: priorSdMs };
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

/** Our cars' sets left (the shared `ourCars` rule, C43): every available set but the fitted one, of a compound the model tells apart. */
function setsOf(view: AsOfView, cars: number): StartingPoint['sets'] {
  const fixed = view.fixed;
  const out: StartingPoint['sets'] = {};
  if (!fixed.playerCar.known || fixed.setsNow === null) return out;
  const teammate = fixed.teammateCar.known ? fixed.teammateCar.value : undefined;
  for (const car of ourCars({ playerCar: fixed.playerCar.value, teammateCar: teammate })) {
    const sets = fixed.setsNow[car];
    if (car >= cars || sets === undefined || !sets.known) continue;
    out[car] = sets.value.sets.flatMap((s, i) =>
      s.available && !s.fitted && i !== sets.value.fittedIdx && isNoiseCompound(s.visualCompound) ? [{ compound: s.visualCompound, wearPct: s.wearPct }] : [],
    );
  }
  return out;
}

/** The starting point as of `frame`: `view` cut with `projectionAsOf`, the `FORECAST_UNITS` run on it (`runAsOf`), then built. */
export function startingPointAt(view: AsOfView, frame: FrameNumber): Known<StartingPoint> {
  const cut = projectionAsOf({ history: view.history, situation: view.situation }, frame);
  const asOf: AsOfView = { ...view, history: cut.history, situation: cut.situation, frame };
  return buildStartingPoint(asOf, runAsOf(FORECAST_UNITS, asOf));
}
