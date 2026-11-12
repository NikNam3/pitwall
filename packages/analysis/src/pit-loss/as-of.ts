// `pit-loss` as of frame N (SP4.3a spec 4.3, 4.4, 6.1, plan Task 15b): every car's stops of the session with their loss,
// and per condition the blend `(n · sessionMedian + k · prior) / (n + k)` of the session's counted stops and the prior:
// `view.priors`' entry, else the track file's default (C62a, C62b). It reads the projection cut at N, the situation at N
// and the run's fixed inputs (`AsOfView`); the scheduled run is `pitLossAsOf(asOfNow(view))`. No accumulator holds priors (C31).
import {
  currentLaps,
  known,
  unknown,
  type EstimateSource,
  type Known,
  type LapRecord,
  type Ms,
  type PitCondition,
  type PitLossEstimate,
  type PitLosses,
  type PitLossStop,
} from '@pitwall/domain';
import type { AsOfView, DeepReadonly, EngineView } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { PIT_LOSS_BEHAVIOUR, phaseRow, type PitLossEffect } from './behaviour.ts';
import { PIT_LOSS_CONFIG } from './config.ts';
import { median, sessionStops, type PitLossOptions } from './loss.ts';
import { PIT_CONDITIONS, pitLossFallback, pitLossKey } from './priors.ts';

/**
 * A condition's prior: its value (unknown without one) and its source as the estimate's without a counted stop, whose
 * `parts` is the prior's word in a blend's (spec 4.4's hover): `calibration`, `track default`.
 */
type Prior = { value: DeepReadonly<Known<number>>; source: EstimateSource };

/**
 * The parts of the view `behaviourFor` (the open spans) and a config section's `read` (the config) look at. Both are
 * typed on the whole `EngineView` though they read only these: the as-of view has no live state.
 */
const readersOf = (view: AsOfView): EngineView => ({ situation: view.situation, config: view.config }) as Pick<EngineView, 'situation' | 'config'> as EngineView;

/**
 * The prior of `condition`: the priors snapshot's entry, else the entry's declared fallback (the track file's default,
 * else none), the one default the run and the calibration panel use (C43).
 */
const priorOf = (view: AsOfView, condition: PitCondition): Prior => {
  if (view.priors.known) {
    const entry = view.priors.value.entries[pitLossKey(condition)];
    const { setName, sources } = view.priors.value;
    if (entry?.known) return { value: entry, source: { kind: 'calibration', setName, sources, sessionShare: 0, parts: 'calibration' } };
  }
  return pitLossFallback(condition)({ config: view.config, track: view.track });
};

/** `n stops`: `1 stop`, `3 stops`. */
const stopsWord = (n: number): string => (n === 1 ? '1 stop' : `${n} stops`);

/** The estimate of one condition from its counted stops' losses and its prior (spec 4.3, 4.4). */
const estimateOf = (losses: readonly Extract<Known<Ms>, { known: true }>[], prior: Prior, k: number): Pick<PitLossEstimate, 'lossMs' | 'source'> => {
  const n = losses.length;
  if (n === 0) return { lossMs: prior.value.known ? known(Math.round(prior.value.value), prior.value.at) : prior.value, source: prior.source };
  const lossesAt = losses.reduce((at, l) => Math.max(at, l.at), 0);
  const sessionMedian = median(losses.map((l) => l.value));
  if (!prior.value.known) return { lossMs: known(Math.round(sessionMedian), lossesAt), source: { kind: 'session', sessionShare: 1, parts: stopsWord(n) } };
  const sessionShare = n / (n + k);
  const value = (n * sessionMedian + k * prior.value.value) / (n + k);
  const parts = `${stopsWord(n)} + ${prior.source.parts}`;
  const source: EstimateSource = sessionShare > 0.5 ? { kind: 'session', sessionShare, parts } : { ...prior.source, sessionShare, parts };
  return { lossMs: known(Math.round(value), Math.max(prior.value.at, lossesAt)), source };
};

/** The median stationary time of a condition's stops that served no penalty (R12), known since the newest one's pit-lane exit. */
const stationaryMedianOf = (view: AsOfView, condition: PitCondition): Known<Ms> => {
  const records = view.history.pitStops.filter((s) => s.flag === condition && !s.penaltyServed);
  if (records.length === 0) return unknown('insufficientData');
  const at = records.reduce((t, s) => Math.max(t, s.pitLaneExit), 0);
  return known(Math.round(median(records.map((s) => s.stationaryTimeMs))), at);
};

/** The output of `pit-loss` as of the view's frame. */
export function pitLossAsOf(view: AsOfView): PitLosses {
  const readers = readersOf(view);
  // the session's row (the weekend phase), over the grid's (C14: a pending phase reads as the race): lap 1 of a race
  // is no reference lap
  const session: PitLossEffect = Object.assign({}, phaseRow('pending'), ...behaviourFor(PIT_LOSS_BEHAVIOUR, readers));
  const opts: PitLossOptions = {
    ...PIT_LOSS_CONFIG.read(readers),
    classes: { isRace: session.isRace === true, ...LAP_CLASSES_CONFIG.read(readers) },
  };
  const stops: PitLossStop[] = sessionStops(view.history.pitStops, currentLaps(view.history.laps as readonly LapRecord[]), opts);
  const conditions = {} as Record<PitCondition, PitLossEstimate>;
  for (const condition of PIT_CONDITIONS) {
    const losses = stops.flatMap((s) => (s.condition === condition && s.use === 'used' && s.lossMs.known ? [s.lossMs] : []));
    const estimate = estimateOf(losses, priorOf(view, condition), opts.priorWeightStops);
    conditions[condition] = { ...estimate, stationaryMedianMs: stationaryMedianOf(view, condition), sessionStops: losses.length };
  }
  return { conditions, stops };
}
