// `pit-loss` (spec 4.3, 4.4): every car's stops of the session with their loss, and per condition the blend
// `(n · sessionMedian + k · prior) / (n + k)` of the session's counted stops and the prior: `view.priors`' entry, else the
// track file's default (C62a, C62b). A quick calculator (C31): no accumulator holds priors.
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
  type PitLossStop,
  type SessionTime,
} from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PIT_LOSS_CONFIG } from './config.ts';
import { median, sessionStops, type PitLossOptions } from './loss.ts';
import { PIT_LOSS, type PitLossOutput } from './index.ts';
import { PIT_CONDITIONS, pitLossKey } from './priors.ts';

/** What a blend's `parts` call each prior (spec 4.4's hover). */
const PRIOR_WORDS = { calibration: 'calibration', default: 'track default' } as const;
/** The source of an estimate that has neither a prior nor a counted stop: its value is unknown. */
const NO_ESTIMATE: EstimateSource = { kind: 'default', note: 'no calibration and no track default', sessionShare: 0, parts: 'no stops' };

/** A condition's prior: its value, since when it is known, and where it comes from. */
type Prior = { value: number; at: SessionTime } & (
  | { kind: 'calibration'; setName: string; sources: number }
  | { kind: 'default'; note: string }
);

/** The prior of `condition`: the priors snapshot's entry, else the track file's default, else none. */
const priorOf = (view: EngineView, condition: PitCondition): Prior | undefined => {
  if (view.priors.known) {
    const entry = view.priors.value.entries[pitLossKey(condition)];
    if (entry?.known) return { value: entry.value, at: entry.at, kind: 'calibration', setName: view.priors.value.setName, sources: view.priors.value.sources };
  }
  if (view.track.known) {
    const fileDefault = view.track.value.defaults.pitLossMs[condition];
    if (fileDefault.known) return { value: fileDefault.value.value, at: fileDefault.at, kind: 'default', note: fileDefault.value.source };
  }
  return undefined;
};

/** `n stops` with the prior's word: `calibration`, `1 stop + calibration`, `3 stops + calibration`. */
const partsOf = (n: number, prior: string | undefined): string => {
  const stops = n === 1 ? '1 stop' : `${n} stops`;
  if (prior === undefined) return stops;
  return n === 0 ? prior : `${stops} + ${prior}`;
};

/** The estimate of one condition from its counted stops' losses and its prior (spec 4.3, 4.4). */
const estimateOf = (losses: readonly Extract<Known<Ms>, { known: true }>[], prior: Prior | undefined, k: number): Pick<PitLossEstimate, 'lossMs' | 'source'> => {
  const n = losses.length;
  const lossesAt = losses.reduce((at, l) => Math.max(at, l.at), 0);
  if (prior === undefined) {
    if (n === 0) return { lossMs: unknown('insufficientData'), source: NO_ESTIMATE };
    return { lossMs: known(Math.round(median(losses.map((l) => l.value))), lossesAt), source: { kind: 'session', sessionShare: 1, parts: partsOf(n, undefined) } };
  }
  const sessionShare = n + k === 0 ? 0 : n / (n + k);
  const value = n === 0 ? prior.value : (n * median(losses.map((l) => l.value)) + k * prior.value) / (n + k);
  const parts = partsOf(n, PRIOR_WORDS[prior.kind]);
  const source: EstimateSource =
    sessionShare > 0.5
      ? { kind: 'session', sessionShare, parts }
      : prior.kind === 'calibration'
        ? { kind: 'calibration', setName: prior.setName, sources: prior.sources, sessionShare, parts }
        : { kind: 'default', note: prior.note, sessionShare, parts };
  return { lossMs: known(Math.round(value), Math.max(prior.at, lossesAt)), source };
};

/** The median stationary time of a condition's stops that served no penalty (R12), known since the newest one's pit-lane exit. */
const stationaryMedianOf = (view: EngineView, condition: PitCondition): Known<Ms> => {
  const records = view.history.pitStops.filter((s) => s.flag === condition && !s.penaltyServed);
  if (records.length === 0) return unknown('insufficientData');
  const at = records.reduce((t, s) => Math.max(t, s.pitLaneExit), 0);
  return known(Math.round(median(records.map((s) => s.stationaryTimeMs))), at);
};

export const pitLossCalculator: QuickCalculator<PitLossOutput> = {
  id: PIT_LOSS,
  kind: 'quick',
  reads: ['pitStops', 'laps', 'decisions'],
  cadence: 'frame',
  compute: (view): PitLossOutput => {
    // the weekend phase is every unit's (C14): lap 1 of a race is no reference lap
    const opts: PitLossOptions = {
      ...PIT_LOSS_CONFIG.read(view),
      classes: { isRace: view.situation.weekendPhase.kind === 'race', ...LAP_CLASSES_CONFIG.read(view) },
    };
    const stops: PitLossStop[] = sessionStops(view.history.pitStops, currentLaps(view.history.laps as readonly LapRecord[]), opts);
    const conditions = {} as Record<PitCondition, PitLossEstimate>;
    for (const condition of PIT_CONDITIONS) {
      const losses = stops.flatMap((s) => (s.condition === condition && s.use === 'used' && s.lossMs.known ? [s.lossMs] : []));
      const estimate = estimateOf(losses, priorOf(view, condition), opts.priorWeightStops);
      conditions[condition] = { ...estimate, stationaryMedianMs: stationaryMedianOf(view, condition), sessionStops: losses.length };
    }
    return { conditions, stops };
  },
};
