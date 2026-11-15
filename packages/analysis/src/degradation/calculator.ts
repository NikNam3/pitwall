// `degradation` (spec 4.1, 4.4): per car in the session and stint, the Kalman filter over the fuel-corrected pace laps,
// started from the calibration's prior for the stint's compound (`view.priors`) or the config default. Quick: from
// scratch over the projection on each frame one of its reads changes (a completed lap, a stint, a pick or its void).
import {
  known,
  scopeOf,
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
import { asOfNow, type AsOfView, type DeepReadonly, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { configOf } from '../shared/config-of.ts';
import { lapsByCar } from '../shared/stint-laps.ts';
import { bestFreshSet, gameSetNuMsPerLap } from '../shared/tyre-prior.ts';
import { TYRE_MODEL_CONFIG } from '../tyre-model/config.ts';
import { DEGRADATION_BEHAVIOUR, phaseRow, type DegradationEffect } from './behaviour.ts';
import { DEGRADATION, DEGRADATION_CONFIG, type DegradationOutput, type StartPrior, type StintDegradation } from './index.ts';
import type { FilterPrior } from './kalman.ts';
import { DEGRADATION_COMPOUNDS, defaultStart, priorKey } from './priors.ts';
import { fitLaps, fuelResolver } from './stint-fit.ts';

type Lap = DeepReadonly<LapRecord>;
type Stint = DeepReadonly<StintRecord>;

/**
 * Where a stint's `ν` starts: the prior, the start the stint carries (`StartPrior`) and how to name the estimate's
 * source once the session's share is known.
 */
type Start = { prior: FilterPrior; startPrior: StartPrior; source: (sessionShare: number, paceLaps: number | typeof NEWEST_LAP) => EstimateSource };

/** The parts word of a base pace taken from the car's newest lap (no fitted stint). */
const NEWEST_LAP = 'newest lap';

const lapsWord = (n: number | typeof NEWEST_LAP): string => (n === NEWEST_LAP ? n : `${n} ${n === 1 ? 'lap' : 'laps'}`);

/** The source of a start from the game's tyre prior. */
const GAME_PRIOR_SOURCE: EstimateSource = { kind: 'default', note: "the game's tyre sets: loss per % × k · 70 / usableLife (research 22)", sessionShare: 0, parts: 'game prior' };

/**
 * `ν` of a stint from the game's tyre prior (SP4.3c Task 12, research 22 §1.6, §2): on the stint's newest lap whose
 * recorded sets give it, the game's ν of the fitted set against the fresh one of its compound the shared pick gives
 * (`bestFreshSet`, `gameSetNuMsPerLap`: the loss per % times the game's rate, with the AI's k, the limit and the loss
 * threshold of `tyre-model`'s config); none without such a lap (the config default then).
 */
function gameNuOf(view: Pick<AsOfView, 'config'>, laps: readonly Lap[]): number | undefined {
  const c = configOf(TYRE_MODEL_CONFIG, view);
  for (let i = laps.length - 1; i >= 0; i--) {
    const sets = (laps[i] as Lap).tyreSets;
    if (!sets.known) continue;
    const fitted = sets.value.find((s) => s.fitted);
    if (fitted === undefined) continue;
    const fresh = bestFreshSet(sets.value, fitted.visualCompound);
    const nu = fresh === undefined ? undefined : gameSetNuMsPerLap(fitted, fresh, c.aiWearFactor, c.limitPct, c.minWearForLossPct);
    if (nu !== undefined) return nu;
  }
  return undefined;
}

/**
 * The start of a stint on `visual` (spec 4.1, 4.4; ruling R41): per key (`ν`, its sd, the `α` offset) the snapshot's
 * entry when it is known, else that key's declared fallback, the default start's field (C43: the calibration panel's
 * one rule). The source is the calibration's when at least one key came from the snapshot, else the default start's;
 * it is `session` once the session's share of `ν`'s precision is above half.
 */
function startOf(view: Pick<AsOfView, 'config' | 'priors' | 'track'>, visual: VisualCompound, gameNu?: number): Start {
  const config = defaultStart({ config: view.config, track: view.track }, visual);
  // the game's tyre prior where the stint's sets give it, the config default otherwise (SP4.3c Task 12)
  const fallback: StartPrior = gameNu === undefined ? config : { ...config, nuMsPerLap: gameNu, source: GAME_PRIOR_SOURCE };
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
  priors: AsOfView['priors'],
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
 * The rows of the spans open in the situation (C20) for the machines of `DEGRADATION_BEHAVIOUR`, in the table's order
 * (`behaviourFor` and `behaviourByCar` over an as-of view): the session's rows, a car's rows, and the cars with a car
 * span open, by id ascending. A span whose kind has no row is a bug in the table (C3): it throws.
 */
function rowsOf(view: Pick<AsOfView, 'situation'>): { session: DegradationEffect[]; car: (carId: CarId) => DegradationEffect[]; cars: CarId[] } {
  const session: DegradationEffect[] = [];
  const byCarRows = new Map<CarId, DegradationEffect[]>();
  for (const [machine, byKind] of Object.entries(DEGRADATION_BEHAVIOUR)) {
    const scope = scopeOf(machine);
    if (scope === undefined) throw new Error(`behaviour table: ${machine} has no span declaration`);
    for (const span of view.situation.byMachine[machine] ?? []) {
      if (!Object.hasOwn(byKind, span.kind)) throw new Error(`behaviour table: no row for ${machine} ${span.kind}`);
      const row = byKind[span.kind] as DegradationEffect;
      if (scope !== 'car') session.push(row);
      else if (span.carId !== undefined) {
        const list = byCarRows.get(span.carId);
        if (list === undefined) byCarRows.set(span.carId, [row]);
        else list.push(row);
      }
    }
  }
  return { session, car: (carId) => byCarRows.get(carId) ?? [], cars: [...byCarRows.keys()].sort((a, b) => a - b) };
}

/**
 * The output as of frame N (SP4.3a spec 6.1, Task 15a): from the projection cut at N and the situation at N, with the
 * run's fixed inputs (our car, ruling R17); the scheduled run is this at the current frame (`asOfNow`). The cars are
 * those whose car-status span open at N has them in the session (C17).
 */
export function degradationAsOf(view: AsOfView): DegradationOutput {
  const config = configOf(DEGRADATION_CONFIG, view);
  const rows = rowsOf(view);
  // the session's rows (the weekend phase), over the grid's (C14: a pending phase reads as the race)
  const session: DegradationEffect = Object.assign({}, phaseRow('pending'), ...rows.session);
  const isRace = session.isRace === true;
  const classes = { isRace, ...configOf(LAP_CLASSES_CONFIG, view) };
  const rate = configOf(PER_LAP_RATE_CONFIG, view);
  const now = view.at;
  const lapsBy = lapsByCar(view.history);
  const recordsBy = byCar(view.history.stints);
  const player = view.fixed.playerCar;
  const fuelOf = fuelResolver(
    player.known
      ? { isRace, ourCar: player.value, ourLaps: () => lapsBy.get(player.value) ?? [], classes, rate, fallbackBurnKgPerLap: config.fallbackBurnKgPerLap }
      : // without our car a rival's fuel hidden by realism stays unknown: no laps to fill it from
        { isRace: false, ourCar: -1 as CarId, ourLaps: () => [], classes, rate, fallbackBurnKgPerLap: config.fallbackBurnKgPerLap },
  );
  const out: DegradationOutput = {};
  for (const carId of rows.cars) {
    const effect: DegradationEffect = Object.assign({}, session, ...rows.car(carId));
    if (effect.inSession !== true) continue;
    const stints = stintsOf(lapsBy.get(carId) ?? [], recordsBy.get(carId) ?? []).map((s, i): StintDegradation & { start: Start } => {
      const start = startOf(view, s.visual, gameNuOf(view, s.laps));
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
        // a fit on lap times without their fuel holds the fuel in its α (B9)
        fuelIncluded: !fit.fuelCorrected,
        source: start.source(sessionShare, fit.paceLaps.length),
        // the same run's posterior: `fitStint`'s, which needs two laps
        cov: fit.paceLaps.length < 2 ? unknown('insufficientData') : known(fit.state.cov, now),
        startPrior: start.startPrior,
        laps: fit.laps,
        start,
      };
    });
    out[carId] = withNewestLapPrior(stints, now).map(({ start: _start, ...stint }) => stint);
  }
  // a competing car without any lap (still on lap 1): the leader's stand-in (the third link of its base pace)
  const standIn = leaderStandIn(out, lapsBy, fuelOf, config, (visual) => startOf(view, visual).startPrior, now);
  if (standIn !== undefined) {
    for (const carId of rows.cars) {
      const own = out[carId];
      if (own !== undefined && (lapsBy.get(carId) ?? []).length === 0 && !own.some((s) => s.basePaceMs.known)) out[carId] = [standIn];
    }
  }
  return out;
}

/** The parts word of a base pace stood in by the leader's newest lap (a car without any lap). */
const LEADER_STAND_IN = 'leader stand-in';

/**
 * The stint of a car without any completed lap (SP4.3c Task 13, O2; moved from `forecast-field`): its base pace is the
 * leader's newest lap (the car in the session with the most laps, the first to complete its newest) less that lap's
 * fuel term, plus `noLapStandInOffsetMs`; the lap time itself where its fuel is unknown (`fuelIncluded`). It runs on the
 * leader's compound, from the default `ν` and its sd, with no laps and no posterior; its source names the stand-in.
 * Only while the leader's newest lap is lap 1 (the cars without a lap are still on it); none before any car has a lap.
 */
function leaderStandIn(
  out: DegradationOutput,
  lapsBy: ReadonlyMap<CarId, readonly Lap[]>,
  fuelOf: (lap: Lap) => Known<number>,
  config: (typeof DEGRADATION_CONFIG)['defaults'],
  startPriorOf: (visual: VisualCompound) => StartPrior,
  now: Ms,
): StintDegradation | undefined {
  let lap: Lap | undefined;
  for (const carId of Object.keys(out).map(Number) as CarId[]) {
    const newest = lapsBy.get(carId)?.at(-1);
    if (newest === undefined) continue;
    if (lap === undefined || newest.lapNumber > lap.lapNumber || (newest.lapNumber === lap.lapNumber && newest.completedAt < lap.completedAt)) lap = newest;
  }
  // only on the first lap: past it a car without a lap is missing data, not a car still on lap 1 (C3)
  if (lap === undefined || lap.lapNumber !== 1) return undefined;
  const fuel = fuelOf(lap);
  const ms = (fuel.known ? lap.lapTimeMs - config.gammaMsPerKg * fuel.value : lap.lapTimeMs) + config.noLapStandInOffsetMs;
  return {
    stint: 1,
    firstLap: 1,
    lastLap: 0,
    actual: lap.actualCompound,
    visual: lap.visualCompound,
    basePaceMs: known(ms, now),
    nuMsPerLap: known(config.defaultNuMsPerLap, now),
    nuSdMs: known(config.defaultNuSdMs, now),
    basis: 'age',
    fuelCorrected: fuel.known,
    fuelIncluded: !fuel.known,
    source: {
      kind: 'default',
      note: "the leader's newest lap less its fuel term, plus noLapStandInOffsetMs (degradation's config)",
      sessionShare: 0,
      parts: LEADER_STAND_IN,
    },
    cov: unknown('insufficientData'),
    startPrior: startPriorOf(lap.visualCompound),
    laps: [],
  };
}

/**
 * A car's pace before any of its stints is fitted (SP4.3c Task 13, O2; moved from `forecast-field`): its newest stint's
 * base pace is its newest lap's time less its fuel term (the lap's corrected time), or the lap time itself where the
 * lap's fuel is unknown (`fuelIncluded`); its source names the newest lap. A car with a fitted stint keeps every stint
 * as fitted; a car without a lap has no pace (C3).
 */
function withNewestLapPrior<S extends StintDegradation & { start: Start }>(stints: S[], now: Ms): S[] {
  const newest = stints.at(-1);
  const lap = newest?.laps.at(-1);
  if (newest === undefined || lap === undefined || stints.some((s) => s.basePaceMs.known)) return stints;
  const prior: S = {
    ...newest,
    basePaceMs: known(lap.correctedMs.known ? lap.correctedMs.value : lap.lapTimeMs, now),
    fuelIncluded: !lap.correctedMs.known,
    source: newest.start.source(0, NEWEST_LAP),
  };
  return [...stints.slice(0, -1), prior];
}

/** Per car in the session (its rows, `DEGRADATION_BEHAVIOUR`): its stints, oldest first; the form at the current frame. */
export const degradationCalculator: QuickCalculator<DegradationOutput> = {
  id: DEGRADATION,
  kind: 'quick',
  reads: ['laps', 'stints', 'pitStops', 'tyres', 'identity', 'decisions', CAR_STATUS_READS, 'spans:weekend-phase'],
  cadence: 'frame',
  compute: (view: EngineView): DegradationOutput => degradationAsOf(asOfNow(view)),
};

