// `weekend-pace` (SP4.3d2 Task 6b, plan call 9): each car's race pace before its first race lap, from the weekend's
// earlier sessions (`view.weekend`, a car matched across sessions by team and race number, C62). Its practice long runs
// (stints of at least `minLongRunLaps` pace laps) give the median of their laps on degradation's basis (ruling R4): each
// lap's fuel-free time is degradation's (`correctedMs`, γ = `lapModelParams`' `fuelMsPerKg`; a car's pace less fuel is
// degradation's alone, C43), taken to tyre age 0 by the priors' slope of the compound (`view.priors`, C62a), else by
// the stint's own `ν` as degradation fits it; a soft or hard run is moved to medium by `lapModelParams`'
// `compoundOffsetMs` (ruling R6). Else its best valid qualifying lap (lap-classes' `forPace` rule) plus
// `raceTrimOffsetMs` (ruling R5); else `unknown('insufficientData')` (C3). Quick: from scratch on each run; it runs on
// a lap record and at the session's start.
import { currentLaps, known, scopeOf, unknown, type CarId, type CarKey, type LapRecord, type VisualCompound, type WeekendPace, type WeekendPhase } from '@pitwall/domain';
import {
  asOfNow,
  asOfStored,
  type AsOfView,
  type DeepReadonly,
  type EngineView,
  type Projection,
  type QuickCalculator,
  type StoredDriverSession,
  type StoredSession,
} from '@pitwall/engine/readers';
import { degradationAsOf } from '../degradation/calculator.ts';
import { DEGRADATION, type StintDegradation } from '../degradation/index.ts';
import { priorKey } from '../degradation/priors.ts';
import { isPaceLap, LAP_CLASSES_CONFIG, type LapClassOptions } from '../lap-classes/index.ts';
import { configOf } from '../shared/config-of.ts';
import { lapModelParams } from '../shared/forecast-field/lap-model-params.ts';
import { median } from '../shared/stats.ts';
import { PENDING_ROW, WEEKEND_PACE_BEHAVIOUR, type WeekendPaceEffect } from './behaviour.ts';
import { WEEKEND_PACE_CONFIG } from './config.ts';
import { WEEKEND_PACE } from './id.ts';

type Lap = DeepReadonly<LapRecord>;
type Config = (typeof WEEKEND_PACE_CONFIG)['defaults'];

/** The dry compounds a long run counts on; each has its offset against medium in the lap model (ruling R6). */
const DRY = ['soft', 'medium', 'hard'] as const satisfies readonly VisualCompound[];
type Dry = (typeof DRY)[number];
const isDry = (c: VisualCompound): c is Dry => (DRY as readonly string[]).includes(c);

/** A car's seat (C62) as a map key. */
const seatOf = (k: DeepReadonly<CarKey>): string => `${k.teamId}:${k.raceNumber}`;

/** How a long-run lap is taken to the medium basis at tyre age 0: the offsets against medium and the priors' slope per compound. */
type Correction = { offsetMs: Record<Dry, number>; priorSlope: (c: Dry) => number | undefined };

/** The sample sd of `xs` (n − 1); 0 for one value. A long run's laps often take two values, so no MAD (it would be 0). */
function sdOf(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / n;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1));
}

/**
 * The corrected laps of one practice stint when it is a long run (at least `minLongRunLaps` laps degradation used with
 * their fuel known), else none: each lap's fuel-free time (`correctedMs`) less the slope times its tyre age (the priors'
 * slope of the compound, else the stint's own `ν`), less its compound's offset against medium.
 */
function longRunOf(stint: DeepReadonly<StintDegradation>, c: Correction, config: Config): number[] {
  if (!isDry(stint.visual)) return [];
  const laps = stint.laps.filter((l) => typeof l.use === 'string' && l.correctedMs.known);
  if (laps.length < config.minLongRunLaps) return [];
  const own = stint.nuMsPerLap.known ? stint.nuMsPerLap.value : undefined;
  const slope = c.priorSlope(stint.visual) ?? own;
  if (slope === undefined) return [];
  const offset = c.offsetMs[stint.visual];
  return laps.flatMap((l) => (l.correctedMs.known ? [l.correctedMs.value - slope * l.tyreAge - offset] : []));
}

/** The best `forPace` lap time per car among `laps` (one record per lap, C25). */
function bestByCar(laps: readonly Lap[], classes: LapClassOptions): Map<CarId, number> {
  const out = new Map<CarId, number>();
  for (const l of currentLaps(laps as readonly LapRecord[])) {
    if (!isPaceLap(l, classes)) continue;
    const best = out.get(l.carId);
    if (best === undefined || l.lapTimeMs < best) out.set(l.carId, l.lapTimeMs);
  }
  return out;
}

/** What the weekend says per seat: its long-run laps (corrected) and its best qualifying lap. */
type Evidence = { longRun: Map<string, number[]>; qualifying: Map<string, number> };

const addBest = (into: Map<string, number>, seat: string, ms: number): void => {
  const best = into.get(seat);
  if (best === undefined || ms < best) into.set(seat, ms);
};

/** A stored session's weekend phase: its projection's `weekend-phase` span (C14, C62), its detail the format and segment. */
function phaseOf(projection: DeepReadonly<Projection>): WeekendPhase | undefined {
  const span = projection.spans['weekend-phase']?.[0];
  if (span === undefined) return undefined;
  return { kind: span.kind, ...(span.detail as object) } as WeekendPhase;
}

/**
 * Degradation's stints of a stored practice session (C43): `degradationAsOf` over the session's projection as of its
 * end (`asOfStored`), with the run's config and track file (the weekend's track).
 */
function storedStints(session: DeepReadonly<StoredSession>, phase: WeekendPhase, view: AsOfView): DeepReadonly<Record<CarId, StintDegradation[]>> {
  const stored: StoredDriverSession = {
    session: { sessionUid: session.sessionUid, weekendId: view.weekend?.weekendId ?? '', feedCar: session.playerCar },
    carId: session.playerCar,
    startedAt: '',
    phase,
    aiDifficulty: unknown('notReceived'),
    totalLaps: unknown('notReceived'),
    // the stored session is read only; the as-of view hands it on as it is
    projection: session.projection as Projection,
    cars: session.cars,
    humanSpans: [],
    track: view.track,
  };
  return degradationAsOf(asOfStored(stored, { config: view.config, overrides: {} })).stints;
}

/** A stored session's evidence, by seat: its practice long runs or its qualifying bests (C62). */
function addStored(into: Evidence, session: DeepReadonly<StoredSession>, view: AsOfView, c: Correction, classes: LapClassOptions, config: Config): void {
  const phase = phaseOf(session.projection);
  if (phase?.kind !== 'practice' && phase?.kind !== 'qualifying') return;
  const seats = new Map(session.cars.map((s) => [s.carId, seatOf(s.carKey)]));
  if (phase.kind === 'qualifying') {
    for (const [car, ms] of bestByCar(session.projection.laps, classes)) {
      const seat = seats.get(car);
      if (seat !== undefined) addBest(into.qualifying, seat, ms);
    }
    return;
  }
  for (const [id, stints] of Object.entries(storedStints(session, phase, view))) {
    const seat = seats.get(Number(id) as CarId);
    if (seat === undefined) continue;
    for (const stint of stints) {
      const corrected = longRunOf(stint, c, config);
      if (corrected.length > 0) into.longRun.set(seat, [...(into.longRun.get(seat) ?? []), ...corrected]);
    }
  }
}

/**
 * The session's row and the rows of the cars in it (C20, C44), from the spans open in the situation for the machines
 * of `WEEKEND_PACE_BEHAVIOUR`: a pending phase has no span and gets `PENDING_ROW`. A kind without a row throws (C3).
 */
function rowsOf(view: Pick<AsOfView, 'situation'>): { session: WeekendPaceEffect; cars: CarId[] } {
  const session: WeekendPaceEffect[] = [];
  const cars = new Map<CarId, WeekendPaceEffect[]>();
  for (const [machine, byKind] of Object.entries(WEEKEND_PACE_BEHAVIOUR)) {
    const scope = scopeOf(machine);
    if (scope === undefined) throw new Error(`behaviour table: ${machine} has no span declaration`);
    for (const span of view.situation.byMachine[machine] ?? []) {
      if (!Object.hasOwn(byKind, span.kind)) throw new Error(`behaviour table: no row for ${machine} ${span.kind}`);
      const row = byKind[span.kind] as WeekendPaceEffect;
      if (scope !== 'car') session.push(row);
      else if (span.carId !== undefined) cars.set(span.carId, [...(cars.get(span.carId) ?? []), row]);
    }
  }
  const sessionRow: WeekendPaceEffect = Object.assign({}, PENDING_ROW, ...session);
  const inSession = [...cars].filter(([, rows]) => Object.assign({}, ...rows).inSession === true).map(([id]) => id);
  return { session: sessionRow, cars: inSession.sort((a, b) => a - b) };
}

/**
 * The output as of frame N: per competing car its pace from the weekend's earlier sessions, and in qualifying also from
 * the session's own laps (the planning round's view, C62d); the scheduled run is this at the current frame (`asOfNow`).
 */
export function weekendPaceAsOf(view: AsOfView): WeekendPace {
  const rows = rowsOf(view);
  const out: WeekendPace = {};
  if (rows.session.sessions === 'notApplicable' || rows.session.sessions === undefined) {
    for (const car of rows.cars) out[car] = unknown('notApplicable');
    return out;
  }
  const keys = view.fixed.carKeys;
  if (!keys.known) {
    for (const car of rows.cars) out[car] = unknown('notReceived');
    return out;
  }
  const config = configOf(WEEKEND_PACE_CONFIG, view);
  const { compoundOffsetMs } = lapModelParams(view, view.outputs);
  const priors = view.priors;
  const correction: Correction = {
    offsetMs: { soft: compoundOffsetMs.soft, medium: compoundOffsetMs.medium, hard: compoundOffsetMs.hard },
    priorSlope: (compound) => {
      if (!priors.known) return undefined;
      const entry = priors.value.entries[priorKey('nuMsPerLap', compound)];
      return entry?.known === true ? entry.value : undefined;
    },
  };
  // no qualifying session is a race: lap 1 is a pace lap there (C14)
  const classes: LapClassOptions = { isRace: false, ...configOf(LAP_CLASSES_CONFIG, view) };
  const evidence: Evidence = { longRun: new Map(), qualifying: new Map() };
  for (const session of view.weekend?.sessions ?? []) addStored(evidence, session, view, correction, classes, config);
  const seatNow = (car: CarId): string | undefined => {
    const k = keys.value[car];
    return k === null || k === undefined ? undefined : seatOf(k);
  };
  if (rows.session.sessions === 'earlierAndOwn') {
    for (const [car, ms] of bestByCar(view.history.laps, classes)) {
      const seat = seatNow(car);
      if (seat !== undefined) addBest(evidence.qualifying, seat, ms);
    }
  }
  for (const car of rows.cars) {
    const seat = seatNow(car);
    if (seat === undefined) {
      out[car] = unknown('notReceived');
      continue;
    }
    const run = evidence.longRun.get(seat);
    const pace = run === undefined ? undefined : median(run);
    if (run !== undefined && pace !== undefined) {
      out[car] = known({ paceMs: Math.round(pace), sdMs: Math.round(sdOf(run)), source: 'longRun', laps: run.length }, view.at);
      continue;
    }
    const best = evidence.qualifying.get(seat);
    out[car] =
      best === undefined
        ? unknown('insufficientData')
        : known({ paceMs: best + config.raceTrimOffsetMs, sdMs: config.qualifyingPaceSdMs, source: 'qualifying', laps: 1 }, view.at);
  }
  return out;
}

/** Per competing car its race pace from the weekend (`WEEKEND_PACE_BEHAVIOUR`); the form at the current frame. */
export const weekendPaceCalculator: QuickCalculator<WeekendPace> = {
  id: WEEKEND_PACE,
  kind: 'quick',
  reads: ['laps', 'stints', 'identity', 'decisions', 'spans:weekend-phase', 'spans:car-status', { calculator: DEGRADATION }],
  cadence: { onChange: ['laps', 'identity', 'decisions', 'spans:weekend-phase'] },
  compute: (view: EngineView): WeekendPace => weekendPaceAsOf(asOfNow(view)),
};
