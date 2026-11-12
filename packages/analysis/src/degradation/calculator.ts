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
function startOf(view: Pick<AsOfView, 'config' | 'priors' | 'track'>, visual: VisualCompound): Start {
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

/** A config section's effective values (as `defineConfig`'s `read`) from the view's config. */
const configOf = <C extends object>(section: { key: string; defaults: C }, view: Pick<AsOfView, 'config'>): C =>
  ({ ...section.defaults, ...view.config[section.key] }) as C;

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
  const lapsBy = lapsByCar(view.history.laps);
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
    out[carId] = stintsOf(lapsBy.get(carId) ?? [], recordsBy.get(carId) ?? []).map((s, i): StintDegradation => {
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
        cov: fit.paceLaps.length < 2 ? unknown('insufficientData') : known(fit.state.cov, now),
        startPrior: start.startPrior,
        laps: fit.laps,
      };
    });
  }
  return out;
}

/** Per car in the session (its rows, `DEGRADATION_BEHAVIOUR`): its stints, oldest first; the form at the current frame. */
export const degradationCalculator: QuickCalculator<DegradationOutput> = {
  id: DEGRADATION,
  kind: 'quick',
  reads: ['laps', 'stints', 'pitStops', 'tyres', 'identity', 'decisions', CAR_STATUS_READS, 'spans:weekend-phase'],
  cadence: 'frame',
  compute: (view: EngineView): DegradationOutput => degradationAsOf(asOfNow(view)),
};

