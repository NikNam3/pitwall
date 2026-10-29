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
  type FlagPhase,
  type LapRecord,
  type MiniSectorCrossing,
  type Ms,
  type RaceEvent,
  type RaceEventKind,
  type SessionState,
  type SessionTime,
} from '../../packages/domain/src/index.ts';
import {
  initialState,
  historyLengths,
  type EngineState,
  type EngineView,
  type FeedMetricsView,
  type History,
} from '../../packages/engine/src/index.ts';
import { buildPacket } from '../../packages/engine/test/builders/index.ts';
import { createCarState } from '../../packages/engine/src/step/initial-state.ts';
import { withholdForRealism } from '../../packages/engine/src/step/realism.ts';

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

/**
 * A confirmed 90 s lap of car 0 (lap 1, sectors three thirds of `lapTimeMs` summing exactly to it (30 s each at 90 s), valid, soft C3, no SC), every `Known` field known at
 * `completedAt`. Lap-end fields: wear 0 % per corner, ERS store 4 MJ, deployed and harvested 0, no damage, channel
 * ranges around tyres 90 to 100 degC and 23 to 27 psi, brakes 300 to 800 degC, engine 110 degC. `completedAt` defaults
 * to `lapNumber * lapTimeMs`. Any field is overridable.
 */
export function lap(over: Partial<LapRecord> = {}): LapRecord {
  const lapNumber = over.lapNumber ?? 1;
  const lapTimeMs = over.lapTimeMs ?? 90_000;
  const at = over.completedAt ?? lapNumber * lapTimeMs;
  const third = Math.floor(lapTimeMs / 3);
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
    ...over,
  };
}

/** The `MINI_SECTORS` (50) crossings of one lap, evenly spaced; segment `i` ends at `startAt + (i + 1) * lapTimeMs / 50` (rounded). */
export function crossings(car: CarId, lapNumber: number, lapTimeMs: Ms, startAt: SessionTime): MiniSectorCrossing[] {
  return Array.from({ length: MINI_SECTORS }, (_, segment) => ({
    carId: car,
    lap: lapNumber,
    segment,
    at: startAt + Math.round(((segment + 1) * lapTimeMs) / MINI_SECTORS),
  }));
}

/** An event at session time 0 with empty `params` and the given `kind`; override `at`, `carId`, `otherCarId`, `params`. */
export function event(over: Partial<RaceEvent> & { kind: RaceEventKind }): RaceEvent {
  return { at: 0, params: {}, ...over };
}

/** A safety-car phase from 0 to 60 s, leader lap 1 to 2, no SC sub-phases; override any field. */
export function flagPhase(over: Partial<FlagPhase> = {}): FlagPhase {
  return { kind: 'SC', start: 0, end: 60_000, startLeaderLap: 1, endLeaderLap: 2, scPhases: [], ...over };
}

/**
 * `cars` cars (ids 0..cars-1) each running `laps` laps from session time 0 at a constant pace: car `i` at `paceMs[i]`
 * (or the one `paceMs` for all; throws if an array is shorter than `cars`). Lap `n` (1-based) of a car is a `lap()` with
 * these defaults: it ends at `n * pace`; sectors are thirds of the pace; `fuelAtStartKg` 100 - 2 * (n - 1) and
 * `fuelAtEndKg` 2 kg less; `tyreAgeAtStart` n - 1 (one stint, soft C3); `wearAtEndPct` n % per corner; ERS store 4 MJ
 * at every lap end; `positionAtEnd` is the car's order by cumulative time at the end of lap n (ties by id). No in or out
 * laps and no SC share are set. `miniSectors` holds `laps * 50` crossings per car, sorted by time.
 */
export function field({ cars, laps, paceMs }: { cars: number; laps: number; paceMs: Ms | Ms[] }): {
  laps: LapRecord[];
  miniSectors: MiniSectorCrossing[];
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
          wearAtEndPct: perCorner(() => known(n, at)),
        }),
      );
      miniSectors.push(...crossings(carId(i), n, pace, (n - 1) * pace));
    }
  }
  miniSectors.sort((a, b) => a.at - b.at);
  return { laps: records, miniSectors };
}

/**
 * A complete, valid car: every `Known` field is known, so a test overrides only what it checks. Defaults: car 0, active,
 * lap 1 (sector 1, lap distance 0) on soft C3, position `id + 1`, no tyre sets (`sets` is known with an empty list), wear 0 %, tyres 95 degC and 25 psi, brakes 500 degC, engine 110 degC, 50 kg
 * fuel, ERS store 4 MJ, no damage. `over` merges key by key; a `Known` or an array is replaced whole. To hide a rival's
 * values the way realism mode does, wrap the result in `realismHidden`.
 */
export function carState(over: DeepPartial<CarState> = {}): CarState {
  const at = 0;
  const id = (over.id ?? carId(0)) as CarId;
  const base = createCarState(id);
  base.active = true;
  base.identity = { ...base.identity, name: `Car ${id}`, raceNumber: id + 1, driverId: id, driverKey: { kind: 'ai', driverId: id } };
  base.timing = {
    ...base.timing,
    position: id + 1,
    lap: 1,
    lapDistanceM: 0,
    sector: 1,
    speedTrapFastestKmh: known(320, at),
    driverStatus: 'onTrack',
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
      drsAllowed: false,
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
 * The `EngineView` of a race session. `cars` (default: none, a 22-slot list is padded with idle cars so ids index it)
 * are placed by their `id`; `history` fills the lists you give and leaves the rest empty; `session` merges onto a
 * default race session; `config` is the effective config by section key (absent sections read their declared defaults);
 * `outputs` are the upstream calculators' outputs; `delta` defaults to "everything in `history` is new". Feed is idle and
 * healthy; `feed` overrides it. `changed` is empty.
 */
export function engineView({
  cars = [],
  history = {},
  session = {},
  config = {},
  outputs = new Map(),
  delta,
  activeFlagPhase,
  feed = {},
  playerCar = 0,
  sessionTime = 0,
}: {
  cars?: CarState[];
  history?: Partial<History>;
  session?: DeepPartial<SessionState>;
  config?: EngineView['config'];
  outputs?: ReadonlyMap<string, unknown>;
  delta?: EngineView['delta'];
  activeFlagPhase?: EngineView['activeFlagPhase'];
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
  const full: History = { laps: [], stints: [], pitStops: [], flagPhases: [], events: [], miniSectors: [], ...history };
  const { open: _open, ...state } = {
    ...base,
    cars: slots,
    history: full,
    session: merge(base.session, session) as SessionState,
    playerCar: carId(playerCar),
    sessionTime,
  };
  const lengths = historyLengths(full);
  return {
    state,
    activeFlagPhase,
    changed: new Set(),
    delta: delta ?? { before: historyLengths({ laps: [], stints: [], pitStops: [], flagPhases: [], events: [], miniSectors: [] }), after: lengths, truncated: false },
    feed: { ...IDLE_FEED, ...feed },
    outputs,
    config,
  };
}

/** A `History` with the given lists and the rest empty: pass it to `engineView({ history })`. */
export function history(lists: Partial<History> = {}): History {
  return { laps: [], stints: [], pitStops: [], flagPhases: [], events: [], miniSectors: [], ...lists };
}
