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
import type { AsOfView, DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import { behaviourByCar, behaviourFor } from '../shared/behaviour.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { DEGRADATION_BEHAVIOUR, phaseRow, type DegradationEffect } from './behaviour.ts';
import { DEGRADATION, DEGRADATION_CONFIG, type DegradationOutput, type StartPrior, type StintDegradation } from './index.ts';
import type { FilterPrior } from './kalman.ts';
import { DEGRADATION_COMPOUNDS, defaultStart, priorKey } from './priors.ts';
import { fitLaps, fuelResolver, lapsByCar } from './stint-fit.ts';

type Lap = DeepReadonly<LapRecord>;
type Stint = DeepReadonly<StintRecord>;

/**
 * Where a stint's `ν` starts: the prior, the start the stint carries (`StartPrior`) and how to name the estimate's
 * source once the session's share is known.
 */
type Start = { prior: FilterPrior; startPrior: StartPrior; source: (sessionShare: number, paceLaps: number) => EstimateSource };

const lapsWord = (n: number): string => `${n} ${n === 1 ? 'lap' : 'laps'}`;

/**
 * The start of a stint on `visual` (spec 4.1, 4.4; ruling R41): per key (`ν`, its sd, the `α` offset) the snapshot's
 * entry when it is known, else that key's declared fallback, the default start's field (C43: the calibration panel's
 * one rule). The source is the calibration's when at least one key came from the snapshot, else the default start's;
 * it is `session` once the session's share of `ν`'s precision is above half.
 */
function startOf(view: EngineView, visual: VisualCompound): Start {
  const fallback = defaultStart({ config: view.config, track: view.track }, visual);
  const snapshot = snapshotOf(view.priors, visual);
  const nu = snapshot?.entry('nuMsPerLap');
  const sd = snapshot?.entry('nuSdMs');
  const offset = snapshot?.entry('alphaOffsetMs');
  const prior: FilterPrior = { nuMsPerLap: nu?.value ?? fallback.nuMsPerLap, nuSdMs: sd?.value ?? fallback.nuSdMs };
  const alphaOffsetMs: Known<Ms> = offset === undefined ? fallback.alphaOffsetMs : known(Math.round(offset.value), offset.at);
  if (snapshot !== undefined && (nu !== undefined || sd !== undefined || offset !== undefined)) {
    const { setName, sources } = snapshot.snapshot;
    const startPrior: StartPrior = { ...prior, alphaOffsetMs, source: { kind: 'calibration', setName, sources, sessionShare: 0, parts: 'calibration' } };
    return {
      prior,
      startPrior,
      source: (sessionShare, paceLaps) => {
        const laps = lapsWord(paceLaps);
        if (sessionShare > 0.5) return { kind: 'session', sessionShare, parts: `${laps} + calibration` };
        return { kind: 'calibration', setName, sources, sessionShare, parts: `${laps} + calibration` };
      },
    };
  }
  return {
    prior,
    startPrior: { ...prior, alphaOffsetMs, source: fallback.source },
    source: (sessionShare, paceLaps) => {
      const laps = lapsWord(paceLaps);
      if (sessionShare > 0.5) return { kind: 'session', sessionShare, parts: `${laps} + default` };
      return { ...fallback.source, sessionShare, parts: `${laps} + default` };
    },
  };
}

/** A priors entry's name for one compound. */
type EntryName = 'alphaOffsetMs' | 'nuMsPerLap' | 'nuSdMs';

/**
 * The snapshot's entries of `visual`, when the run has a snapshot and the compound has priors: `entry(name)` gives the
 * entry when it is known, else `undefined`.
 */
function snapshotOf(
  priors: EngineView['priors'],
  visual: VisualCompound,
): { snapshot: DeepReadonly<PriorsSnapshot>; entry: (name: EntryName) => { value: number; at: Ms } | undefined } | undefined {
  if (!priors.known || !(DEGRADATION_COMPOUNDS as readonly string[]).includes(visual)) return undefined;
  const snapshot = priors.value;
  return {
    snapshot,
    entry: (name) => {
      const e = snapshot.entries[priorKey(name, visual)];
      return e?.known === true ? { value: e.value, at: e.at } : undefined;
    },
  };
}

/**
 * A car's laps by stint, oldest first: each closed stint record's laps, then the laps after the last record (the open
 * stint). Without a record every lap is one stint. A stint is the record's compound, an open one its first lap's.
 */
function stintsOf(
  laps: readonly Lap[],
  records: readonly Stint[],
): { laps: Lap[]; firstLap: number; lastLap: number; actual: Lap['actualCompound']; visual: Lap['visualCompound'] }[] {
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
    return { laps: laps.slice(range.from, range.to), firstLap: r.firstLap, lastLap: r.lastLap, actual: r.actualCompound, visual: r.visualCompound };
  });
  const open = laps.slice(openFrom);
  const first = open[0];
  const newest = open.at(-1);
  if (first !== undefined && newest !== undefined) {
    out.push({ laps: open, firstLap: first.lapNumber, lastLap: newest.lapNumber, actual: first.actualCompound, visual: first.visualCompound });
  }
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

/**
 * The output as of frame N (SP4.3a spec 6.1, Task 15a): from the projection cut at N and the situation at N, with the
 * run's fixed inputs; the scheduled run is this at the current frame (`asOfNow`).
 */
export function degradationAsOf(_view: AsOfView): DegradationOutput {
  throw new Error('not implemented');
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
        const start = startOf(view, s.visual);
        const fit = fitLaps(s.laps, fuelOf, start.prior, config, classes, rate);
        const pnn = fit.state.cov[1][1];
        const priorVar = start.prior.nuSdMs * start.prior.nuSdMs;
        const sessionShare = priorVar > 0 ? Math.max(0, 1 - pnn / priorVar) : 0;
        const alpha = fit.state.alphaMs;
        return {
          stint: i + 1,
          firstLap: s.firstLap,
          lastLap: s.lastLap,
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