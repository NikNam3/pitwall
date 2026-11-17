// `driver-noise` as of a frame (SP4.3a spec 5.2, 6.1): a pure function of the `AsOfView`. Per car the model of the
// driver at the frame (its car-driver span), each value its session estimate shrunk towards its prior: a human's
// profile entry (`view.drivers`), else the human default; an AI car's the AI default, its σ the AI field's own median
// this session. Every value is a `Known` with its source (C3).
import { known, unknown, type CarId, type CarNoise, type DriverNoise, type DriverProfile, type EstimateSource } from '@pitwall/domain';
import type { AsOfView, DeepReadonly } from '@pitwall/engine/readers';
import { DAMAGE_CONFIG } from '../damage/config.ts';
import { INCIDENTS_CONFIG } from '../incidents/config.ts';
import { median } from '../shared/stats.ts';
import { isPlanningAt, isRaceAt } from './behaviour.ts';
import { DRIVER_NOISE_CONFIG } from './config.ts';
import { carModelsOf, type CarModels, type Model, type ModelEstimates, type ResidualConfig } from './residuals.ts';
import { shrink, type Prior, type SessionEstimate } from './shrink.ts';

type Config = (typeof DRIVER_NOISE_CONFIG)['defaults'];

/** The profile entry keys (spec 4, `DRIVER_NOISE_PROFILES`). */
export const PROFILE_KEYS = {
  sigmaMs: 'driverNoise.sigmaMs',
  rho: 'driverNoise.rho',
  mistakeRate: 'driverNoise.mistakeRate',
  mistakeMedianMs: 'driverNoise.mistakeMedianMs',
  mistakeSigmaLog: 'driverNoise.mistakeSigmaLog',
} as const;

/** The config `driver-noise` reads, its own and the time-loss detection's (C43: `incidents`' and `damage`'s thresholds). */
export function residualConfigOf(view: Pick<AsOfView, 'config'>): { own: Config; residual: ResidualConfig } {
  const own = DRIVER_NOISE_CONFIG.read(view);
  const { timeLossMs, mergeMs } = INCIDENTS_CONFIG.read(view);
  const { jumpPct, jumpWindowMs } = DAMAGE_CONFIG.read(view);
  return { own, residual: { freeAirGapMs: own.freeAirGapMs, rejoinSkipLaps: own.rejoinSkipLaps, mistakeSigmas: own.mistakeSigmas, bigEventMs: own.bigEventMs, timeLoss: { timeLossMs, mergeMs, jumpPct, jumpWindowMs } } };
}

const NA = unknown('notApplicable');

const defaultSource = (note: string): EstimateSource => ({ kind: 'default', note, sessionShare: 0, parts: 'default' });
const CONFIG_DEFAULT = defaultSource('driver-noise config');

/** A car's entry outside the race phase: every value `notApplicable`. */
function notApplicableCar(driver: CarNoise['driver']): CarNoise {
  return {
    driver,
    sigmaMs: NA,
    rho: NA,
    mistakeRatePerLap: NA,
    mistakeSize: NA,
    bigEventRatePerLap: NA,
    retireRatePerLap: NA,
    source: CONFIG_DEFAULT,
    laps: 0,
  };
}

/** A rate's session estimate: `count / base`, none on an empty base. */
const rateOf = (count: number, base: number): SessionEstimate => (base > 0 ? { value: count / base, n: base } : undefined);

/** The priors of one model of one car. */
type Priors = {
  sigmaMs: Prior;
  rho: Prior;
  mistakeRate: Prior;
  mistakeMedianMs: Prior;
  mistakeSigmaLog: Prior;
  bigEventRate: Prior;
  retireRate: Prior;
};

/** A profile's entry `key` as a prior, if known. */
function profilePrior(profile: DeepReadonly<DriverProfile> | undefined, key: string): Prior | undefined {
  if (profile === undefined) return undefined;
  const entry = profile.entries[key];
  if (entry === undefined || !entry.value.known) return undefined;
  return { value: entry.value.value, source: { kind: 'profile', person: profile.person, laps: entry.laps, sessionShare: 0, parts: 'profile' } };
}

/** A human's priors: each its profile entry, else the human default. */
function humanPriors(profile: DeepReadonly<DriverProfile> | undefined, c: Config): Priors {
  const d = (value: number): Prior => ({ value, source: defaultSource('driver-noise human default') });
  return {
    sigmaMs: profilePrior(profile, PROFILE_KEYS.sigmaMs) ?? d(c.humanSigmaMs),
    rho: profilePrior(profile, PROFILE_KEYS.rho) ?? d(c.humanRho),
    mistakeRate: profilePrior(profile, PROFILE_KEYS.mistakeRate) ?? d(c.humanMistakeRate),
    mistakeMedianMs: profilePrior(profile, PROFILE_KEYS.mistakeMedianMs) ?? d(c.humanMistakeMedianMs),
    mistakeSigmaLog: profilePrior(profile, PROFILE_KEYS.mistakeSigmaLog) ?? d(c.humanMistakeSigmaLog),
    bigEventRate: d(c.humanBigEventRate),
    retireRate: d(c.humanRetireRate),
  };
}

/** The AI priors: the AI default, its σ the AI field's own median σ this session where one is measured. */
function aiPriors(fieldSigmaMs: number | undefined, c: Config): Priors {
  const d = (value: number): Prior => ({ value, source: defaultSource('driver-noise AI default') });
  return {
    sigmaMs: fieldSigmaMs === undefined ? d(c.aiSigmaMs) : { value: fieldSigmaMs, source: defaultSource("driver-noise AI default, σ the AI field's median this session") },
    rho: d(c.aiRho),
    mistakeRate: d(c.aiMistakeRate),
    mistakeMedianMs: d(c.aiMistakeMedianMs),
    mistakeSigmaLog: d(c.aiMistakeSigmaLog),
    bigEventRate: d(c.aiBigEventRate),
    retireRate: d(c.aiRetireRate),
  };
}

/** One car's entry: the model of its driver, each value shrunk towards its prior (its wear rates are `tyre-model`'s). */
function carNoiseOf(car: CarModels, model: ModelEstimates, priors: Priors, c: Config): CarNoise {
  const k = c.shrinkLaps;
  const at = model.at ?? 0;
  const sigma = shrink(model.sigmaMs, priors.sigmaMs, k);
  const rho = shrink(model.rho, priors.rho, k);
  const mistakeRate = shrink(rateOf(model.mistakes, model.mistakeBase), priors.mistakeRate, k);
  const medianMs = shrink(model.mistakeMedianMs, priors.mistakeMedianMs, k);
  const sigmaLog = shrink(model.mistakeSigmaLog, priors.mistakeSigmaLog, k);
  const big = shrink(rateOf(model.bigEvents, model.paceLaps), priors.bigEventRate, k);
  const retire = shrink(rateOf(model.retirements, model.allLaps), priors.retireRate, k);
  return {
    driver: car.driver,
    sigmaMs: known(sigma.value, at),
    rho: known(rho.value, at),
    mistakeRatePerLap: known(mistakeRate.value, at),
    mistakeSize: known({ medianMs: Math.round(medianMs.value), sigmaLog: sigmaLog.value }, at),
    bigEventRatePerLap: known(big.value, at),
    retireRatePerLap: known(retire.value, at),
    source: sigma.source,
    laps: model.laps,
  };
}

/** The model a car's entry reports: its driver's; a car without a car-driver span the AI's. */
const reportedModel = (car: CarModels): Model => (car.driver === 'human' ? 'human' : 'ai');

/**
 * Every car's models and what their entries share: the config, the AI priors, the AI field's rates; `planning`: the
 * planning view (qualifying, C62d), `estimatesOf`.
 */
type Field = { c: Config; cars: Map<CarId, CarModels>; ai: Priors; aiField: DriverNoise['aiField']; planning: boolean };

/** A model without session estimates: every value its prior (`shrink` without a session estimate). */
const NO_ESTIMATES: ModelEstimates = {
  laps: 0,
  allLaps: 0,
  paceLaps: 0,
  sigmaMs: undefined,
  rho: undefined,
  mistakes: 0,
  mistakeBase: 0,
  mistakeMedianMs: undefined,
  mistakeSigmaLog: undefined,
  bigEvents: 0,
  retirements: 0,
  at: undefined,
};

/**
 * The field as of `view`'s frame; outside the race and its planning view `undefined`. On the planning view (qualifying,
 * C62d) the AI cars' and the AI field's values are the config's AI values: qualifying's AI laps are no race laps.
 */
function fieldOf(view: AsOfView, c: Config, cars: Map<CarId, CarModels>): Field | undefined {
  const planning = isPlanningAt(view);
  if (!planning && !isRaceAt(view)) return undefined;
  // the AI field: its own median σ (the AI prior's σ) and its pooled rates
  const aiSigmas: number[] = [];
  const pooled = { mistakes: 0, mistakeBase: 0, bigEvents: 0, paceLaps: 0, retirements: 0, allLaps: 0 };
  let fieldAt = 0;
  for (const car of planning ? [] : cars.values()) {
    const ai = car.models.ai;
    if (ai.sigmaMs !== undefined) aiSigmas.push(ai.sigmaMs.value);
    pooled.mistakes += ai.mistakes;
    pooled.mistakeBase += ai.mistakeBase;
    pooled.bigEvents += ai.bigEvents;
    pooled.paceLaps += ai.paceLaps;
    pooled.retirements += ai.retirements;
    pooled.allLaps += ai.allLaps;
    fieldAt = Math.max(fieldAt, ai.at ?? 0);
  }
  const ai = aiPriors(median(aiSigmas), c);
  const k = c.shrinkLaps;
  const aiField: DriverNoise['aiField'] = {
    mistakeRatePerLap: known(shrink(rateOf(pooled.mistakes, pooled.mistakeBase), ai.mistakeRate, k).value, fieldAt),
    bigEventRatePerLap: known(shrink(rateOf(pooled.bigEvents, pooled.paceLaps), ai.bigEventRate, k).value, fieldAt),
    retireRatePerLap: known(shrink(rateOf(pooled.retirements, pooled.allLaps), ai.retireRate, k).value, fieldAt),
  };
  return { c, cars, ai, aiField, planning };
}

/** One car's entry with `model`'s values. */
function entryOf(view: AsOfView, field: Field, id: CarId, car: CarModels, model: Model): CarNoise {
  const profile = model === 'human' ? profileOf(view, id) : undefined;
  const priors = model === 'human' ? humanPriors(profile, field.c) : field.ai;
  return carNoiseOf(car, estimatesOf(field, car, model), priors, field.c);
}

/**
 * The session estimates `model`'s entry rests on. On the planning view (C62d) an AI car has none (its values the config's)
 * and a human no mistakes: qualifying's time-loss events are not counted (they are the race's, `carModelsOf`), so its
 * mistake rate and size are its prior's; its σ, ρ and big events rest on the session's laps.
 */
function estimatesOf(field: Field, car: CarModels, model: Model): ModelEstimates {
  const own = car.models[model];
  if (!field.planning) return own;
  if (model === 'ai') return NO_ESTIMATES;
  return { ...own, mistakes: 0, mistakeBase: 0, mistakeMedianMs: undefined, mistakeSigmaLog: undefined };
}

/** Every car's noise model and the AI field's rates, as of `view`'s frame. */
export function driverNoiseAsOf(view: AsOfView): DriverNoise {
  const { own: c, residual } = residualConfigOf(view);
  const cars = carModelsOf(view, residual);
  const field = fieldOf(view, c, cars);
  const out: DriverNoise['cars'] = {};
  if (field === undefined) {
    for (const [id, car] of cars) out[id] = notApplicableCar(car.driver);
    return { cars: out, aiField: { mistakeRatePerLap: NA, bigEventRatePerLap: NA, retireRatePerLap: NA } };
  }
  for (const [id, car] of cars) out[id] = entryOf(view, field, id, car, reportedModel(car));
  return { cars: out, aiField: field.aiField };
}

/**
 * Car `carId`'s entry with its human model's values, whoever drove it last (a driver profile's session: the linked
 * car's human-span laps, C62c); `undefined` outside the race or without the car. It equals the car's entry of
 * `driverNoiseAsOf` when the car's driver is human.
 */
export function humanNoiseAsOf(view: AsOfView, carId: CarId): CarNoise | undefined {
  const { own: c, residual } = residualConfigOf(view);
  const cars = carModelsOf(view, residual);
  const field = fieldOf(view, c, cars);
  const car = cars.get(carId);
  if (field === undefined || car === undefined) return undefined;
  return { ...entryOf(view, field, carId, car, 'human'), driver: car.driver };
}

/** The car slot's linked driver profile (`view.drivers`, C62c), if any. */
function profileOf(view: AsOfView, carId: CarId): DeepReadonly<DriverProfile> | undefined {
  const linked = view.drivers[carId];
  return linked !== undefined && linked.known ? linked.value : undefined;
}
