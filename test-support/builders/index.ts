// Shared test vocabulary for engine history and views (spec 11.1): analysis tests build their input with these
// and override only what they test. Imports are relative because the repo root does not link workspace packages.
import {
  carId,
  feedId,
  known,
  MAX_CARS,
  MINI_SECTORS,
  type CarId,
  type CarState,
  type Corners,
  type Known,
  type LapRecord,
  type MachineId,
  type MiniSectorCrossing,
  type Ms,
  type NeutralisedDetail,
  type OpenSpan,
  type RaceEvent,
  type RaceEventKind,
  type SessionState,
  type SessionTime,
  type Span,
  type SuspendedDetail,
} from '../../packages/domain/src/index.ts';
import {
  initialState,
  projectionLengths,
  type EngineState,
  type EngineView,
  type FeedMetricsView,
  type Projection,
} from '../../packages/engine/src/index.ts';
import { buildPacket } from '../../packages/engine/test/builders/index.ts';
import { createCarState } from '../../packages/engine/src/step/state-update/initial.ts';
import { withholdForRealism } from '../../packages/engine/src/step/state-update/realism.ts';
import { withholdRestricted } from '../../packages/engine/src/step/state-update/restricted.ts';

/** Overrides nested objects key by key; arrays and `Known` values are replaced whole. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends { known: boolean }
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function merge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (!isPlain(base) || !isPlain(over) || 'known' in over) return over;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(over)) out[key] = merge(base[key], over[key]);
  return out;
}

/** Feed health of a healthy connection: every counter 0, 60 packets/s, no loss. */
export const IDLE_FEED: FeedMetricsView = {
  framesClosed: 0,
  incompleteFrames: 0,
  latePackets: 0,
  droppedBeforeSession: 0,
  droppedUid0: 0,
  decodeErrors: 0,
  packetsPerSecond: 60,
  connected: true,
  msSinceLastPacket: 0,
  lossPercent: 0,
};

const range = (min: number, max: number) => ({ min, max });
const perCorner = <T>(make: () => T): Corners<T> => ({ fl: make(), fr: make(), rl: make(), rr: make() });
const mapCorners = <T, U>(c: Corners<T>, f: (v: T) => U): Corners<U> => ({ fl: f(c.fl), fr: f(c.fr), rl: f(c.rl), rr: f(c.rr) });

/** One `lap()`'s own gain (end minus start) by default: it burns 2 kg of fuel, and its wear and ERS store do not change. */
export const LAP_GAIN = { fuelKg: -2, wearPct: 0, ersStoreJ: 0 } as const;

/**
 * A confirmed 90 s lap of car 0 (lap 1, sectors three thirds of `lapTimeMs` summing exactly to it (30 s each at 90 s), valid, soft C3, no SC), every `Known` field known at
 * `completedAt`. Lap-start samples: fuel 100 kg, wear 0 % per corner, ERS store 4 MJ. Lap-end fields: fuel 98 kg, wear 0 % per corner, ERS store 4 MJ, deployed and harvested 0, no damage, channel
 * ranges around tyres 90 to 100 degC and 23 to 27 psi, brakes 300 to 800 degC, engine 110 degC. `completedAt` defaults
 * to `lapNumber * lapTimeMs`. It describes frame 0, no applied frame (C26): set `frame` where membership matters. Any field is overridable.
 *
 * One lap's gain (end minus start) defaults to `LAP_GAIN`: fuel -2 kg, wear and ERS store 0. A lap-end sample set
 * without its lap-start sample (`fuelAtEndKg` without `fuelAtStartKg`, and so on) gets a start that is the end minus that
 * default gain, as of the end's `at`, per corner for wear (an unknown end gives the same unknown start). So a cumulative
 * end value (wear 30 % after many laps) is never read as one lap's gain; a test of a lap's own gain sets both samples.
 */
export function lap(over: Partial<LapRecord> = {}): LapRecord {
  const lapNumber = over.lapNumber ?? 1;
  const lapTimeMs = over.lapTimeMs ?? 90_000;
  const at = over.completedAt ?? lapNumber * lapTimeMs;
  const third = Math.floor(lapTimeMs / 3);
  const startOf = <T extends number>(end: Known<T>, gain: number): Known<T> => (end.known ? known((end.value - gain) as T, end.at) : end);
  const starts: Partial<LapRecord> = {
    ...(over.fuelAtEndKg && !over.fuelAtStartKg && { fuelAtStartKg: startOf(over.fuelAtEndKg, LAP_GAIN.fuelKg) }),
    ...(over.wearAtEndPct && !over.wearAtStartPct && { wearAtStartPct: mapCorners(over.wearAtEndPct, (w) => startOf(w, LAP_GAIN.wearPct)) }),
    ...(over.ersStoreAtEndJ && !over.ersStoreAtStartJ && { ersStoreAtStartJ: startOf(over.ersStoreAtEndJ, LAP_GAIN.ersStoreJ) }),
  };
  return {
    carId: carId(0),
    lapNumber,
    lapTimeMs,
    sectorTimesMs: [third, third, lapTimeMs - 2 * third],
    valid: { lap: true, sectors: [true, true, true] },
    actualCompound: 'C3',
    visualCompound: 'soft',
    tyreAgeAtStart: 0,
    fuelAtStartKg: known(100, at),
    fuelAtEndKg: known(98, at),
    scShare: 0,
    vscShare: 0,
    inLap: false,
    outLap: false,
    positionAtEnd: 1,
    status: 'confirmed',
    completedAt: at,
    wearAtStartPct: perCorner(() => known(0, at)),
    ersStoreAtStartJ: known(4_000_000, at),
    wearAtEndPct: perCorner(() => known(0, at)),
    ersStoreAtEndJ: known(4_000_000, at),
    ersDeployedJ: known(0, at),
    ersHarvestedJ: known(0, at),
    damageAtEnd: known(
      {
        frontLeftWingPct: 0,
        frontRightWingPct: 0,
        rearWingPct: 0,
        floorPct: 0,
        diffuserPct: 0,
        sidepodPct: 0,
        gearboxPct: 0,
        enginePct: 0,
      },
      at,
    ),
    channelRange: {
      tyres: perCorner(() => ({
        surfaceC: known(range(90, 100), at),
        carcassC: known(range(90, 100), at),
        pressurePsi: known(range(23, 27), at),
      })),
      brakesC: perCorner(() => known(range(300, 800), at)),
      engineC: known(range(110, 110), at),
    },
    frame: 0,
    ...starts,
    ...over,
  };
}

/**
 * The `MINI_SECTORS` (50) crossings of one lap, evenly spaced, in the engine's convention: segment `i` is at
 * `startAt + round(i * lapTimeMs / 50)`, so segment 0 is the start/finish line at the start of the lap. The line that
 * completes the lap is the next lap's segment 0 (`crossings(car, lap + 1, ..., startAt + lapTimeMs)[0]`). Each describes
 * frame 0, no applied frame (C26).
 */
export function crossings(car: CarId, lapNumber: number, lapTimeMs: Ms, startAt: SessionTime): MiniSectorCrossing[] {
  return Array.from({ length: MINI_SECTORS }, (_, segment) => ({
    carId: car,
    lap: lapNumber,
    segment,
    at: startAt + Math.round((segment * lapTimeMs) / MINI_SECTORS),
    frame: 0,
  }));
}

/** An event at session time 0 of frame 0 with empty `params` and the given `kind`; override `at`, `frame`, `carId`, `otherCarId`, `params`. */
export function event(over: Partial<RaceEvent> & { kind: RaceEventKind }): RaceEvent {
  return { at: 0, params: {}, frame: 0, ...over };
}

/** The race's session-phase sub-machine: its `neutralised` and `suspended` spans are the neutralisations (C17, C20). */
export const RACE_PHASES: MachineId = 'session-phase-race';

/** What a neutralisation is: an SC or a VSC (a `neutralised` span, its `detail.car`), or a red flag (a `suspended` span). */
export type NeutralisationOver = {
  kind?: 'SC' | 'VSC' | 'red';
  start?: SessionTime;
  end?: SessionTime;
  confirmed?: boolean;
  id?: number;
  machine?: MachineId;
  startFrame?: number;
  endFrame?: number;
};

/**
 * A closed span of a session-phase sub-machine standing for a neutralisation (C17, C20): by default a confirmed SC
 * (`neutralised`, deployed at its start) of `session-phase-race` from 0 to 60 s, span id 0; `kind: 'red'` is a
 * `suspended` span whose restart is not yet known. Its frames default to its times (`startFrame = start`,
 * `endFrame = end`): tests that give their crossings and laps `frame = at` keep frames and times in one order (C26).
 */
export function neutralisation({
  kind = 'SC',
  start = 0,
  end = 60_000,
  confirmed = true,
  id = 0,
  machine = RACE_PHASES,
  startFrame = start,
  endFrame = end,
}: NeutralisationOver = {}): Span {
  const detail: NeutralisedDetail | SuspendedDetail =
    kind === 'red' ? { restart: { known: false, reason: 'notReceived' } } : { car: kind, stages: [{ stage: 'deployed', at: start }] };
  return { machine, id, kind: kind === 'red' ? 'suspended' : 'neutralised', start, end, confirmed, detail, startFrame, endFrame };
}

/** The same span still open, as `view.situation` holds it (C20): no `end`, no `endFrame`. */
export function openNeutralisation(over: Omit<NeutralisationOver, 'end' | 'endFrame'> = {}): OpenSpan {
  const { end: _end, endFrame: _endFrame, ...open } = neutralisation(over);
  return open;
}

/**
 * The view parts of these session-phase spans (C20): the closed ones in the projection's `spans`, the open one in the
 * situation's `byMachine`, each under its machine; the situation is a race (`RACING`) unless `situation` says otherwise.
 * Pass `spans` in `engineView({ history })` and `situation` as `engineView({ situation })`.
 */
export function phaseSpans(
  closed: readonly Span[] = [],
  open?: OpenSpan,
  situation: EngineView['situation'] = RACING,
): { spans: Record<MachineId, Span[]>; situation: EngineView['situation'] } {
  const spans: Record<MachineId, Span[]> = {};
  for (const span of closed) (spans[span.machine] ??= []).push(span);
  const byMachine = open === undefined ? situation.byMachine : { ...situation.byMachine, [open.machine]: [open] };
  return { spans, situation: { ...situation, byMachine } };
}

/**
 * `cars` cars (ids 0..cars-1) each running `laps` laps from session time 0 at a constant pace: car `i` at `paceMs[i]`
 * (or the one `paceMs` for all; throws if an array is shorter than `cars`). Lap `n` (1-based) of a car is a `lap()` with
 * these defaults: it ends at `n * pace`; sectors are thirds of the pace; `fuelAtStartKg` 100 - 2 * (n - 1) and
 * `fuelAtEndKg` 2 kg less; `tyreAgeAtStart` n - 1 (one stint, soft C3); `wearAtStartPct` n - 1 and `wearAtEndPct` n % per corner (1 % a
 * lap); ERS store 4 MJ at every lap start and end; `positionAtEnd` is the car's order by cumulative time at the end of lap n (ties by id). No in or out
 * laps and no SC share are set. `crossings` holds, per car, laps 1..n with segments 0..49 plus the closing line crossing (lap n + 1, segment 0) at `n * pace`, so `laps * 50 + 1` crossings per car, sorted by time (engine convention, see `crossings`).
 * The linear defaults have no physical floor or ceiling: fuel at the end of a lap goes below 0 kg after lap 50 and wear
 * above 100 % after lap 100, so a test that needs real values keeps `laps` below those or overrides them.
 */
export function field({ cars, laps, paceMs }: { cars: number; laps: number; paceMs: Ms | Ms[] }): {
  laps: LapRecord[];
  crossings: MiniSectorCrossing[];
} {
  if (typeof paceMs !== 'number' && paceMs.length < cars) throw new Error(`field: ${paceMs.length} paces for ${cars} cars`);
  const paceOf = (i: number): Ms => (typeof paceMs === 'number' ? paceMs : paceMs[i]!);
  const rank = (i: number, n: number): number =>
    1 +
    Array.from({ length: cars }, (_, j) => j).filter((j) => n * paceOf(j) < n * paceOf(i) || (n * paceOf(j) === n * paceOf(i) && j < i)).length;
  const records: LapRecord[] = [];
  const miniSectors: MiniSectorCrossing[] = [];
  for (let i = 0; i < cars; i++) {
    const pace = paceOf(i);
    for (let n = 1; n <= laps; n++) {
      const at = n * pace;
      const start = 100 - 2 * (n - 1);
      records.push(
        lap({
          carId: carId(i),
          lapNumber: n,
          lapTimeMs: pace,
          positionAtEnd: rank(i, n),
          tyreAgeAtStart: n - 1,
          fuelAtStartKg: known(start, at),
          fuelAtEndKg: known(start - 2, at),
          wearAtStartPct: perCorner(() => known(n - 1, at)),
          wearAtEndPct: perCorner(() => known(n, at)),
        }),
      );
      miniSectors.push(...crossings(carId(i), n, pace, (n - 1) * pace));
    }
    miniSectors.push({ carId: carId(i), lap: laps + 1, segment: 0, at: laps * pace, frame: 0 });
  }
  miniSectors.sort((a, b) => a.at - b.at);
  return { laps: records, crossings: miniSectors };
}

/**
 * A complete, valid car: every `Known` field is known, so a test overrides only what it checks. Defaults: car 0,
 * lap 1 (sector 1, lap distance 0) on soft C3, position `id + 1`, no tyre sets (`sets` is known with an empty list), wear 0 %, tyres 95 degC and 25 psi, brakes 500 degC, engine 110 degC, 50 kg
 * fuel, ERS store 4 MJ, no damage. `over` merges key by key; a `Known` or an array is replaced whole. To hide a rival's
 * values the way realism mode does, wrap the result in `realismHidden`.
 */
export function carState(over: DeepPartial<CarState> = {}): CarState {
  const at = 0;
  const id = (over.id ?? carId(0)) as CarId;
  const base = createCarState(id);
  base.identity = { ...base.identity, name: `Car ${id}`, raceNumber: id + 1, driverId: id, driverKey: { kind: 'ai', driverId: id } };
  base.timing = {
    ...base.timing,
    position: id + 1,
    lap: 1,
    lapDistanceM: 0,
    sector: 1,
    speedTrapFastestKmh: known(320, at),
    gridPosition: id + 1,
  };
  base.tyres = {
    actualCompound: 'C3',
    visualCompound: 'soft',
    age: 0,
    corners: perCorner(() => ({
      surfaceTempC: known(95, at),
      carcassTempC: known(95, at),
      pressurePsi: known(25, at),
      wearPct: known(0, at),
      damagePct: known(0, at),
      blistersPct: known(0, at),
    })),
    sets: known({ sets: [], fittedIdx: 0 }, at),
  };
  base.energy = {
    fuel: known({ kg: 50, capacityKg: 110, remainingLaps: 20, mix: 'standard' as const }, at),
    ers: known({ storeJ: 4_000_000, mode: 'medium' as const, harvestedMgukJ: 0, harvestedMguhJ: 0, deployedJ: 0 }, at),
    power: known({ iceW: 400_000, mgukW: 120_000 }, at),
  };
  base.condition = {
    bodywork: known(
      { frontLeftWingPct: 0, frontRightWingPct: 0, rearWingPct: 0, floorPct: 0, diffuserPct: 0, sidepodPct: 0 },
      at,
    ),
    powerUnit: known(
      {
        engineDamagePct: 0,
        gearboxDamagePct: 0,
        mguhWearPct: 0,
        esWearPct: 0,
        ceWearPct: 0,
        iceWearPct: 0,
        mgukWearPct: 0,
        tcWearPct: 0,
      },
      at,
    ),
    drsFault: known(false, at),
    ersFault: false,
    engineBlown: false,
    engineSeized: false,
    brakes: perCorner(() => ({ tempC: known(500, at), damagePct: known(0, at) })),
    engineTempC: known(110, at),
  };
  base.dynamics = known(
    {
      speedKmh: 200,
      throttle: 1,
      brake: 0,
      steer: 0,
      clutchPct: 0,
      gear: 6,
      rpm: 10_000,
      maxRpm: 13_000,
      revLightsPct: 50,
      drs: false,
      drsActivationDistanceM: 0,
      pitLimiter: false,
    },
    at,
  );
  return merge(base, over) as CarState;
}

/** A copy of the car as realism mode shows a rival: the engine's own `withholdForRealism` sets the hidden fields to `unknown('realism')`. */
export function realismHidden(car: CarState): CarState {
  const copy = structuredClone(car);
  withholdForRealism(copy);
  return copy;
}

/**
 * A copy of the car as the game sends a human who withholds their telemetry: its visibility is `restricted` and the
 * engine's own `withholdRestricted` sets the restricted fields (fuel, ERS, wear, damage, tyre sets) to `unknown('restricted')`.
 */
export function telemetryRestricted(car: CarState): CarState {
  const copy = structuredClone(car);
  copy.identity.visibility = 'restricted';
  withholdRestricted(copy);
  return copy;
}

/** The view's situation by default: a race, no span open (the session phase is in the projection's spans, C20). */
export const RACING: EngineView['situation'] = { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine: {} };

/**
 * The `EngineView` of a race session. `cars` (default: none, a 22-slot list is padded with idle cars so ids index it)
 * are placed by their `id`; `history` fills the lists you give and leaves the rest empty; `session` merges onto a
 * default race session; `config` is the effective config by section key (absent sections read their declared defaults);
 * `outputs` are the upstream calculators' outputs; `delta` defaults to "everything in `history` is new"; `situation`
 * defaults to `RACING`. Feed is idle and healthy; `feed` overrides it. `changed` is empty; no weekend context, no priors.
 */
export function engineView({
  cars = [],
  history = {},
  session = {},
  config = {},
  outputs = new Map(),
  delta,
  situation = RACING,
  feed = {},
  playerCar = 0,
  sessionTime = 0,
}: {
  cars?: CarState[];
  history?: Partial<Projection>;
  session?: DeepPartial<SessionState>;
  config?: EngineView['config'];
  outputs?: ReadonlyMap<string, unknown>;
  delta?: EngineView['delta'];
  situation?: EngineView['situation'];
  feed?: Partial<FeedMetricsView>;
  playerCar?: number;
  sessionTime?: SessionTime;
} = {}): EngineView {
  const base: EngineState = initialState({
    feedId: feedId('test'),
    sessionUid: 1n,
    session: buildPacket('session', { totalLaps: 50, trackLength: 5000, sessionType: 15 }),
  });
  const slots = Array.from({ length: Math.max(MAX_CARS, ...cars.map((c) => c.id + 1)) }, (_, i) => base.cars[i] ?? createCarState(carId(i)));
  for (const c of cars) slots[c.id] = c;
  const full: Projection = { ...emptyProjection(), ...history };
  const { open: _open, log: _log, history: _history, weekend: _weekend, signals: _signals, frameNumber: _frameNumber, ...live } = {
    ...base,
    cars: slots,
    session: merge(base.session, session) as SessionState,
    playerCar: carId(playerCar),
    sessionTime,
  };
  const lengths = projectionLengths(full);
  return {
    live,
    situation,
    history: full,
    changed: new Set(),
    delta: delta ?? { before: projectionLengths(emptyProjection()), after: lengths },
    weekend: undefined,
    feed: { ...IDLE_FEED, ...feed },
    outputs,
    config,
    priors: {},
  };
}

/** A projection with every list empty. */
const emptyProjection = (): Projection => ({
  laps: [], stints: [], pitStops: [], crossings: [], events: [], penalties: [], clock: [], spans: {},
});

/** A projection with the given lists and the rest empty: pass it to `engineView({ history })`. */
export function history(lists: Partial<Projection> = {}): Projection {
  return { ...emptyProjection(), ...lists };
}
