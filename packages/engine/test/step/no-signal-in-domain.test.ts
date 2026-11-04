// C13: no signal appears in the live state, a fact, the view or a topic, and no `domain` type has a signal field. The
// signals of the closed list (C12) live only in `Signals` (`state.signals`), which step 1 writes and only the machine
// reads (C8, C9). Two rows: the types (every domain type the live state, the projection, the span details and the
// analyses' values are built from), and the live state at runtime on every frame of every committed segment of at most
// 1 MB.
import { readdirSync, statSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  BattleCard,
  CarBands,
  CarDynamics,
  CarIdentity,
  CarState,
  CarTiming,
  DamageState,
  DrsOffDetail,
  ErsState,
  ForecastSample,
  FuelState,
  GameSettings,
  GapperLines,
  IncidentEntry,
  InvalidLapDetail,
  LapBoard,
  Neighbourhood,
  NeutralisedDetail,
  PausedDetail,
  PendingPenaltyDetail,
  PracticePhaseDetail,
  QualifyingPhaseDetail,
  RaceMoment,
  RacePhaseDetail,
  RetiredDetail,
  ServingPenaltyDetail,
  SessionState,
  SuspendedDetail,
  TimePenaltyDetail,
  TyreWear,
  WarnedDetail,
  ZoneFlagDetail,
} from '@pitwall/domain';
import type { StepResult } from '../../src/index.ts';
import type { Projection } from '../../src/log/types.ts';
import type { SignalKey } from '../../src/signals/types.ts';
import type { Situation } from '../../src/situations/situation.ts';
import type { LiveState } from '../../src/state/live-state.ts';
import { replaySegment } from '../support/segment-run.ts';
import { segmentPath } from '../../../../test-support/segments.ts';

/**
 * A C12 field by any name it has had: the name `Signals` gives it (`SignalKey`, but the events, which are no field) and
 * the game's name where that differs. Spelled out as a record, so a new `SignalKey` must be named here.
 */
const C12_FIELDS = {
  pitStatus: true,
  driverStatus: true,
  pitLaneTimerActive: true,
  resultStatus: true,
  numPitStops: true,
  shouldServePenalty: true,
  pitStopShouldServePen: true,
  unservedDriveThroughs: true,
  numUnservedDriveThroughPens: true,
  unservedStopGos: true,
  numUnservedStopGoPens: true,
  timePenaltyMs: true,
  totalWarnings: true,
  cornerCuttingWarnings: true,
  currentLapInvalid: true,
  fiaFlag: true,
  vehicleFIAFlags: true,
  vehicleFiaFlags: true,
  drsAllowed: true,
  networkPaused: true,
  aiControlled: true,
  safetyCarStatus: true,
  marshalZones: true,
  periods: true,
  numSafetyCarPeriods: true,
  numVirtualSafetyCarPeriods: true,
  numRedFlagPeriods: true,
  sessionType: true,
  weekendStructure: true,
  numSessionsInWeekend: true,
  ruleSet: true,
  gamePaused: true,
  isSpectating: true,
  spectatorCarIndex: true,
  numActiveCars: true,
} as const satisfies Record<Exclude<SignalKey, 'events'>, true> & Record<string, true>;
type C12Field = keyof typeof C12_FIELDS;

/**
 * The domain fields that carry a signal under a name other readers use too (`kind`, `flag`, `active`, `ai` are fine
 * elsewhere), by their path in the live state: the session kind (from `sessionType`), the session flag (from
 * `safetyCarStatus`), a car's identity `ai` (from `aiControlled`) and `car.active` (from `resultStatus` and
 * `numActiveCars`, the transitional judgement that car-status replaces, Task 24 ruling 1).
 */
const ALIAS_PATHS: ReadonlySet<string> = new Set(['session.kind', 'session.flag', 'cars[].identity.ai', 'cars[].active']);

/** A leaf: a primitive (branded ones too: `CarId` is a `number`) or a function. */
type Leaf = string | number | boolean | bigint | symbol | null | undefined | ((...args: never[]) => unknown);
/**
 * The C12 fields `T` holds at any depth, through objects, arrays and every member of a union (a `Known`); `never` when
 * it holds none.
 */
type SignalFieldsOf<T> = T extends Leaf
  ? never
  : T extends readonly (infer E)[]
    ? SignalFieldsOf<E>
    : { [K in keyof T & string]-?: Extract<K, C12Field> | SignalFieldsOf<T[K]> }[keyof T & string];

describe('no domain type has a C12 field (C13)', () => {
  it('a car: its identity, timing and dynamics', () => {
    expectTypeOf<SignalFieldsOf<CarIdentity>>().toEqualTypeOf<never>();
    expectTypeOf<SignalFieldsOf<CarTiming>>().toEqualTypeOf<never>();
    expectTypeOf<SignalFieldsOf<CarDynamics>>().toEqualTypeOf<never>();
    expectTypeOf<SignalFieldsOf<CarState>>().toEqualTypeOf<never>();
  });

  it('a car has no `active` and its identity no `ai`', () => {
    expectTypeOf<CarState>().not.toHaveProperty('active');
    expectTypeOf<CarIdentity>().not.toHaveProperty('ai');
  });

  it('the session: its settings and its forecast samples', () => {
    expectTypeOf<SignalFieldsOf<GameSettings>>().toEqualTypeOf<never>();
    expectTypeOf<SignalFieldsOf<ForecastSample>>().toEqualTypeOf<never>();
    expectTypeOf<SignalFieldsOf<SessionState>>().toEqualTypeOf<never>();
  });

  it('the session has no `kind` and no `flag`', () => {
    expectTypeOf<SessionState>().not.toHaveProperty('kind');
    expectTypeOf<SessionState>().not.toHaveProperty('flag');
  });

  it('the live state, the situation and the projection (facts and spans)', () => {
    expectTypeOf<SignalFieldsOf<LiveState>>().toEqualTypeOf<never>();
    expectTypeOf<SignalFieldsOf<Situation>>().toEqualTypeOf<never>();
    expectTypeOf<SignalFieldsOf<Projection>>().toEqualTypeOf<never>();
  });

  it('the span details of every sub-machine', () => {
    type Details =
      | PausedDetail
      | ZoneFlagDetail
      | InvalidLapDetail
      | WarnedDetail
      | DrsOffDetail
      | PendingPenaltyDetail
      | TimePenaltyDetail
      | RetiredDetail
      | ServingPenaltyDetail
      | NeutralisedDetail
      | SuspendedDetail
      | PracticePhaseDetail
      | QualifyingPhaseDetail
      | RacePhaseDetail;
    expectTypeOf<SignalFieldsOf<Details>>().toEqualTypeOf<never>();
  });

  it("the analyses' values", () => {
    type Values = BattleCard | CarBands | DamageState | ErsState | FuelState | GapperLines | Neighbourhood | IncidentEntry | RaceMoment | LapBoard | TyreWear;
    expectTypeOf<SignalFieldsOf<Values>>().toEqualTypeOf<never>();
  });
});

/** The live state of a step's state, as `LiveState` cuts it from the engine state. */
const liveOf = (state: StepResult['state']) => {
  const { open: _open, history: _history, weekend: _weekend, signals: _signals, log: _log, frameNumber: _frameNumber, ...live } = state;
  expectTypeOf<keyof typeof live>().toEqualTypeOf<keyof LiveState>();
  return live;
};

/** The last key of each alias path: only a key named so needs its path built. */
const ALIAS_KEYS: ReadonlySet<string> = new Set([...ALIAS_PATHS].map((p) => p.slice(p.lastIndexOf('.') + 1)));

/**
 * The paths (`cars[].timing.pitStatus`) at which `value` holds a C12 field, added to `found`. `path` is the keys down to
 * `value` (`[]` for an array's items), joined only for a hit: the scan runs on every frame.
 */
const signalPaths = (value: unknown, path: string[], found: Set<string>): void => {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    path.push('[]');
    for (const item of value) signalPaths(item, path, found);
    path.pop();
    return;
  }
  for (const key in value) {
    if (Object.hasOwn(C12_FIELDS, key) || (ALIAS_KEYS.has(key) && ALIAS_PATHS.has(joined([...path, key])))) found.add(joined([...path, key]));
    path.push(key);
    signalPaths((value as Record<string, unknown>)[key], path, found);
    path.pop();
  }
};
const joined = (path: readonly string[]): string => path.join('.').replaceAll('.[]', '[]');

/**
 * Every committed segment of at most 1 MB (`fixtures/segments/`, C84). The full-lap segments (about 8 MB, the C84
 * exception) take longer than a unit test may (docs/testing.md section 4); the other segments cover the same sessions.
 */
const SEGMENTS = readdirSync(segmentPath(''))
  .filter((f) => f.endsWith('.pwrec.gz') && statSync(segmentPath(f)).size <= 1024 * 1024)
  .sort();

describe('the live state of every segment frame holds no C12 field (C13)', () => {
  it('there are segments to scan', () => {
    expect(SEGMENTS.length).toBeGreaterThan(0);
  });

  it.each(SEGMENTS)('%s', async (file) => {
    const found = new Set<string>();
    await replaySegment(file, (state) => signalPaths(liveOf(state), [], found));
    expect([...found].sort()).toEqual([]);
  });
});
