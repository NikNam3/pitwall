// `degradation` (spec 4.1, 4.4): per car in the session and stint, the Kalman filter over the fuel-corrected pace laps,
// started from the calibration's prior for the stint's compound (`view.priors`) or the config default. Quick: from
// scratch over the projection on each frame one of its reads changes (a completed lap, a stint, a pick or its void).
import {
  known,
  unknown,
  type CarId,
  type EstimateSource,
  type Known,
  type LapRecord,
  type Ms,
  type PriorsSnapshot,
  type StintRecord,
  type VisualCompound,
} from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import { behaviourByCar, behaviourFor } from '../shared/behaviour.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { DEGRADATION_BEHAVIOUR, phaseRow, type DegradationEffect } from './behaviour.ts';
import { DEGRADATION, DEGRADATION_CONFIG, type DegradationOutput, type StartPrior, type StintDegradation } from './index.ts';
import type { FilterPrior } from './kalman.ts';
import { DEGRADATION_COMPOUNDS, priorKey } from './priors.ts';
import { fitLaps, fuelResolver, lapsByCar } from './stint-fit.ts';

type Lap = DeepReadonly<LapRecord>;
type Stint = DeepReadonly<StintRecord>;
type Config = (typeof DEGRADATION_CONFIG)['defaults'];

/**
 * Where a stint's `ν` starts: the prior, the start the stint carries (`StartPrior`) and how to name the estimate's
 * source once the session's share is known.
 */
type Start = { prior: FilterPrior; startPrior: StartPrior; source: (sessionShare: number, paceLaps: number) => EstimateSource };

const lapsWord = (n: number): string => `${n} ${n === 1 ? 'lap' : 'laps'}`;

/** The default source's note: the config default's. */
const CONFIG_NOTE = 'degradation config default (pitwall estimate)';

/**
 * A stint's default start on `visual` (spec 4.1): with the track file's offset for the compound, its `compoundOffsetsMs`
 * source as the note and the offset as `α`'s; else the config default's note and no offset. The offset is carried only:
 * the filter's `α` stays diffuse.
 */
function defaultStart(track: EngineView['track'], visual: VisualCompound): { note: string; trackNote: boolean; alphaOffsetMs: Known<Ms> } {
  const offsets = track.known ? track.value.defaults.compoundOffsetsMs : undefined;
  if (offsets?.known === true && Object.hasOwn(offsets.value.value, visual)) {
    const value = offsets.value.value[visual as keyof typeof offsets.value.value];
    return { note: offsets.value.source, trackNote: true, alphaOffsetMs: known(value, offsets.at) };
  }
  return { note: CONFIG_NOTE, trackNote: false, alphaOffsetMs: unknown('notApplicable') };
}

/**
 * The start of a stint on `visual` (spec 4.1, 4.4): the calibration's `ν` and sd for the compound when the snapshot holds
 * both, else the config default. The source is `session` once the session's share of `ν`'s precision is above half.
 */
function startOf(priors: EngineView['priors'], track: EngineView['track'], visual: VisualCompound, config: Config): Start {
  const calibration = calibrationPrior(priors, visual);
  if (calibration !== undefined) {
    const { setName, sources } = calibration.snapshot;
    const startPrior: StartPrior = {
      ...calibration.prior,
      alphaOffsetMs: calibration.alphaOffsetMs,
      source: { kind: 'calibration', setName, sources, sessionShare: 0, parts: 'calibration' },
    };
    return {
      prior: calibration.prior,
      startPrior,
      source: (sessionShare, paceLaps) => {
        const laps = lapsWord(paceLaps);
        if (sessionShare > 0.5) return { kind: 'session', sessionShare, parts: `${laps} + calibration` };
        return { kind: 'calibration', setName, sources, sessionShare, parts: `${laps} + calibration` };
      },
    };
  }
  const prior = { nuMsPerLap: config.defaultNuMsPerLap, nuSdMs: config.defaultNuSdMs };
  const d = defaultStart(track, visual);
  return {
    prior,
    startPrior: {
      ...prior,
      alphaOffsetMs: d.alphaOffsetMs,
      source: { kind: 'default', note: d.note, sessionShare: 0, parts: d.trackNote ? 'track default' : 'config default' },
    },
    source: (sessionShare, paceLaps) => {
      const laps = lapsWord(paceLaps);
      if (sessionShare > 0.5) return { kind: 'session', sessionShare, parts: `${laps} + default` };
      return { kind: 'default', note: d.note, sessionShare, parts: `${laps} + default` };
    },
  };
}

/**
 * The calibration's prior of `visual`: `ν` and its sd from the snapshot, when it holds both, with the compound's `α`
 * offset (whole ms, C4; `insufficientData` when the snapshot holds none).
 */
function calibrationPrior(
  priors: EngineView['priors'],
  visual: VisualCompound,
): { prior: FilterPrior; alphaOffsetMs: Known<Ms>; snapshot: DeepReadonly<PriorsSnapshot> } | undefined {
  if (!priors.known || !(DEGRADATION_COMPOUNDS as readonly string[]).includes(visual)) return undefined;
  const nu = priors.value.entries[priorKey('nuMsPerLap', visual)];
  const sd = priors.value.entries[priorKey('nuSdMs', visual)];
  if (nu === undefined || sd === undefined || !nu.known || !sd.known) return undefined;
  const offset = priors.value.entries[priorKey('alphaOffsetMs', visual)];
  const alphaOffsetMs: Known<Ms> =
    offset === undefined ? unknown('insufficientData') : offset.known ? known(Math.round(offset.value), offset.at) : unknown(offset.reason);
  return { prior: { nuMsPerLap: nu.value, nuSdMs: sd.value }, alphaOffsetMs, snapshot: priors.value };
}

/**
 * A car's laps by stint, oldest first: each closed stint record's laps, then the laps after the last record (the open
 * stint). Without a record every lap is one stint. A stint is the record's compound, an open one its first lap's.
 */
function stintsOf(laps: readonly Lap[], records: readonly Stint[]): { laps: Lap[]; actual: Lap['actualCompound']; visual: Lap['visualCompound'] }[] {
  // the laps are in lap order, the records in stint order: one pass. A record's laps and the open stint's are each a
  // run of consecutive laps, kept as its index range [from, to) and sliced once.
  const ranges = records.map(() => ({ from: 0, to: 0 }));
  let openFrom = laps.length;
  const after = records.at(-1)?.lastLap ?? 0;
  let k = 0;
  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i] as Lap;
    if (lap.lapNumber > after) {
      openFrom = Math.min(openFrom, i);
      continue;
    }
    while (k < records.length && (records[k]?.lastLap ?? Infinity) < lap.lapNumber) k++;
    const r = records[k];
    const range = ranges[k];
    if (r === undefined || range === undefined || lap.lapNumber < r.firstLap) continue;
    if (range.to === range.from) range.from = i;
    range.to = i + 1;
  }
  const out = records.map((r, j) => {
    const range = ranges[j] ?? { from: 0, to: 0 };
    return { laps: laps.slice(range.from, range.to), actual: r.actualCompound, visual: r.visualCompound };
  });
  const open = laps.slice(openFrom);
  const first = open[0];
  if (first !== undefined) out.push({ laps: open, actual: first.actualCompound, visual: first.visualCompound });
  return out;
}

/** Groups `items` by their car id, keeping their order. */
function byCar<T extends { carId: CarId }>(items: readonly T[]): Map<CarId, T[]> {
  const out = new Map<CarId, T[]>();
  for (const item of items) {
    const list = out.get(item.carId);
    if (list === undefined) out.set(item.carId, [item]);
    else list.push(item);
  }
  return out;
}

/** Per car in the session (its rows, `DEGRADATION_BEHAVIOUR`): its stints, oldest first. */
export const degradationCalculator: QuickCalculator<DegradationOutput> = {
  id: DEGRADATION,
  kind: 'quick',
  reads: ['laps', 'stints', 'pitStops', 'tyres', 'identity', 'decisions', CAR_STATUS_READS, 'spans:weekend-phase'],
  cadence: 'frame',
  compute: (view: EngineView): DegradationOutput => {
    const config = DEGRADATION_CONFIG.read(view);
    // the session's rows (the weekend phase), over the grid's (C14: a pending phase reads as the race)
    const session: DegradationEffect = Object.assign({}, phaseRow('pending'), ...behaviourFor(DEGRADATION_BEHAVIOUR, view));
    const isRace = session.isRace === true;
    const classes = { isRace, ...LAP_CLASSES_CONFIG.read(view) };
    const rate = PER_LAP_RATE_CONFIG.read(view);
    const now = view.live.sessionTime;
    const rows = behaviourByCar(DEGRADATION_BEHAVIOUR, view);
    const lapsBy = lapsByCar(view.history.laps);
    const recordsBy = byCar(view.history.stints);
    const ourCar = view.live.playerCar;
    const fuelOf = fuelResolver({
      isRace,
      ourCar,
      ourLaps: () => lapsBy.get(ourCar) ?? [],
      classes,
      rate,
      fallbackBurnKgPerLap: config.fallbackBurnKgPerLap,
    });
    const out: DegradationOutput = {};
    for (const car of view.live.cars) {
      const effect: DegradationEffect = Object.assign({}, session, ...rows(car.id));
      if (effect.inSession !== true) continue;
      out[car.id] = stintsOf(lapsBy.get(car.id) ?? [], recordsBy.get(car.id) ?? []).map((s, i): StintDegradation => {
        const start = startOf(view.priors, view.track, s.visual, config);
        const fit = fitLaps(s.laps, fuelOf, start.prior, config, classes, rate);
        const pnn = fit.state.cov[1][1];
        const priorVar = start.prior.nuSdMs * start.prior.nuSdMs;
        const sessionShare = priorVar > 0 ? Math.max(0, 1 - pnn / priorVar) : 0;
        const alpha = fit.state.alphaMs;
        return {
          stint: i + 1,
          actual: s.actual,
          visual: s.visual,
          basePaceMs: alpha === undefined ? unknown('insufficientData') : known(Math.round(alpha), now),
          nuMsPerLap: known(fit.state.nuMsPerLap, now),
          nuSdMs: known(Math.sqrt(Math.max(0, pnn)), now),
          basis: fit.basis,
          fuelCorrected: fit.fuelCorrected,
          wearRatePctPerLap: fit.wearRatePctPerLap,
          source: start.source(sessionShare, fit.paceLaps.length),
          // the same run's posterior: `fitStint`'s, which needs two laps
          cov: fit.paceLaps.length < 2 ?unknown('insufficientData') : known(fit.state.cov, now),
          startPrior: start.startPrior,
          laps: fit.laps,
        };
      });
    }
    return out;
  },
};