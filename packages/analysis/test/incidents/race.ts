// Test races for `incidents`: mini-sector histories in the engine's convention (ruling R3) with incidents built in.
// Boundary `s` of lap `L` is the crossing (L, s); segment 0 is the start/finish line at the START of lap L, so the
// crossing that completes lap L is (L + 1, 0). Mini-sector `s` of lap L runs from (L, s) to (L, s + 1), or to
// (L + 1, 0) for s = 49. The situations come as spans (C20): `chain` and its helpers build a car's contiguous spans of
// one sub-machine, `viewOf` puts the closed ones in the projection and the open ones in the situation. Every test runs
// the calculator through its guarded view (`incidents`, C41).
import {
  carId,
  known,
  MINI_SECTORS,
  type CarId,
  type DamageState,
  type LapRecord,
  type MachineId,
  type MiniSectorCrossing,
  type OpenSpan,
  type PitStopRecord,
  type RaceEvent,
  type SessionState,
  type Span,
  type WeekendPhase,
  unknown,
} from '@pitwall/domain';
import { projectionLengths, type EngineView } from '@pitwall/engine';
import { engineView, lap as lapRecord } from '../../../../test-support/builders/index.ts';
import { incidentsCalculator } from '../../src/incidents/calculator.ts';
import { DAMAGE, type DamageOutput } from '../../src/damage/index.ts';
import { GAPS, type GapsOutput } from '../../src/gaps/index.ts';
import type { IncidentsOutput } from '../../src/incidents/index.ts';
import { incidentsHistoryCalculator } from '../../src/index.ts';
import { split } from '../split.ts';

export const PACE_MS = 90_000;
/** One mini-sector at 90 s a lap. */
export const SEGMENT_MS = PACE_MS / MINI_SECTORS;
/** Car `i` starts `i * SPACING_MS` after car 0, so it is that far behind it everywhere: P(i + 1). */
export const SPACING_MS = 700;
export const CARS = 10;
export const LAPS = 8;
/** The test track: 5 000 m (the builder's session), so a mini-sector is 100 m; sector 2 starts at 1 600 m, sector 3 at 3 300 m. */
export const TRACK = { trackLengthM: 5_000, sector2StartM: 1_600, sector3StartM: 3_300 } as const;
/** Our car: car 6, P7. With 700 ms spacing its neighbourhood (±1 position or ±3000 ms) is cars 2..9 except itself. */
export const PLAYER = carId(6);

/** A delay of `ms` in mini-sector `segment` of lap `lap` of a car: every later boundary of that car moves by `ms`. */
export type Delay = { carId: CarId; lap: number; segment: number; ms: number };

/** When car `id` starts lap 1 (crosses (1, 0)). */
export const startOf = (id: number): number => id * SPACING_MS;

/** The undelayed time car `id` crosses boundary `segment` of lap `lap`. */
export const boundaryAt = (id: number, lap: number, segment: number): number =>
  startOf(id) + (lap - 1) * PACE_MS + segment * SEGMENT_MS;

/**
 * Every car runs `laps` laps at 90 s from `startOf(i)`: boundaries (1, 0) .. (laps, 49) plus the closing (laps + 1, 0).
 * `delays` slow a car down in one mini-sector; the list is sorted by time, ties by car id. Each crossing describes the
 * frame numbered by its time (`frame = at`), as `neutralisation` spans and `leaderLaps` do, so frames and times agree.
 */
export function race({ cars = CARS, laps = LAPS, delays = [] }: { cars?: number; laps?: number; delays?: Delay[] } = {}): MiniSectorCrossing[] {
  const list: MiniSectorCrossing[] = [];
  for (let i = 0; i < cars; i++) {
    const own = delays.filter((d) => d.carId === i);
    const index = (lap: number, segment: number) => (lap - 1) * MINI_SECTORS + segment;
    for (let lap = 1; lap <= laps + 1; lap++) {
      for (let segment = 0; segment < MINI_SECTORS; segment++) {
        if (lap === laps + 1 && segment > 0) break;
        // A delay in mini-sector k moves boundary k + 1 and everything after it.
        const late = own.filter((d) => index(d.lap, d.segment) < index(lap, segment)).reduce((sum, d) => sum + d.ms, 0);
        const at = boundaryAt(i, lap, segment) + late;
        list.push({ carId: carId(i), lap, segment, at, frame: at });
      }
    }
  }
  return list.sort((a, b) => a.at - b.at || a.carId - b.carId);
}

/**
 * The leader's (car 0's) lap records of laps 1..n, at 90 s from 0: lap k completes at k × 90 000 and describes the frame
 * numbered by that time (`frame = completedAt`), as `race` numbers its crossings.
 */
export const leaderLaps = (n: number): LapRecord[] =>
  Array.from({ length: n }, (_, i) => lapRecord({ carId: carId(0), lapNumber: i + 1, completedAt: (i + 1) * PACE_MS, frame: (i + 1) * PACE_MS }));

/** The history up to and including session time `t` (a prefix of each time-sorted list). */
export const until = <T extends { at: number }>(list: T[], t: number): T[] => list.filter((x) => x.at <= t);

/**
 * The calculator as every test runs it: `incidents` and its fold `incidents-history` (C31.2), each part through its own
 * guarded view (C41), so a read it does not declare throws. Its `init` and `update` see the view a unit sees.
 */
export const incidents = split(incidentsCalculator, incidentsHistoryCalculator);

/** One step of a car's (or the session's) contiguous spans of one sub-machine: its kind, from `at`, on frame `frame`. */
export type SpanStep = { kind: string; at: number; detail?: unknown; confirmed?: boolean; joinedAt?: boolean; frame?: number };

/**
 * A car's contiguous spans of `machine` (C9, C26): each step opens at its `at`, on frame `frame` (default: the frame
 * numbered by its time, as `race` numbers its crossings), and closes when the next one opens; the last one closes at
 * `end` (on frame `endFrame`, default `end`) or stays open. Span ids count from 0. `car` undefined: a session span.
 */
export function chain(machine: MachineId, car: number | undefined, steps: SpanStep[], end?: number, endFrame = end): Array<Span | OpenSpan> {
  return steps.map((step, id) => {
    const next = steps[id + 1];
    const closeAt = next?.at ?? end;
    const closeFrame = next === undefined ? endFrame : (next.frame ?? next.at);
    const open: OpenSpan = {
      machine,
      id,
      kind: step.kind,
      start: step.at,
      confirmed: step.confirmed ?? true,
      detail: step.detail,
      startFrame: step.frame ?? step.at,
      ...(car !== undefined && { carId: carId(car) }),
      ...(step.joinedAt === true && { joinedAt: true as const }),
    };
    return closeAt === undefined || closeFrame === undefined ? open : { ...open, end: closeAt, endFrame: closeFrame };
  });
}

/** The span is closed: it has its end frame (C20). */
export const isClosedSpan = (span: Span | OpenSpan): span is Span => 'endFrame' in span;

/**
 * The spans as the view holds them at session time `t`: those opened by then, a span that closes after `t` open (its
 * end and end frame dropped), as `until` cuts the lists.
 */
export function spansUntil(spans: Array<Span | OpenSpan>, t: number): Array<Span | OpenSpan> {
  return spans
    .filter((s) => s.start <= t)
    .map((s) => {
      if (!isClosedSpan(s) || s.end <= t) return s;
      const { end: _end, endFrame: _endFrame, ...open } = s;
      return open;
    });
}

/** A car's car-location spans: on track from 0 (the engine joined there), then these steps. */
export const location = (car: number, steps: SpanStep[] = [], end?: number): Array<Span | OpenSpan> =>
  chain('car-location', car, [{ kind: 'track', at: 0, joinedAt: true }, ...steps], end);

/** A car's car-status spans: competing from 0 (the engine joined so), then these steps. */
export const status = (car: number, steps: SpanStep[] = []): Array<Span | OpenSpan> =>
  chain('car-status', car, [{ kind: 'competing', at: 0, joinedAt: true }, ...steps]);

/** The detail of a `retired` span: its cause, not received. */
export const RETIRED = { cause: unknown('notReceived') };

/** A car's warnings spans: no warning from 0 (the engine joined so), then a `warned` span per time, the count rising by one each. */
export const warned = (car: number, times: number[]): Array<Span | OpenSpan> =>
  chain('warnings', car, [
    { kind: 'noWarning', at: 0, detail: {}, joinedAt: true },
    ...times.map((at, i): SpanStep => ({ kind: 'warned', at, detail: { count: i + 1, infringement: known(7, at) } })),
  ]);

/** What a car owes in a penalties span step: drive-throughs, stop-gos and time penalties in total. */
export type Owed = { at: number; dt?: number; sg?: number; totalMs?: number; joinedAt?: boolean };

/** The penalties span (kind and detail) of what a car owes, as the penalties sub-machine names it (oldest unserved first: a drive-through). */
export const owedStep = ({ at, dt = 0, sg = 0, totalMs = 0, joinedAt }: Owed): SpanStep => {
  const base = { at, ...(joinedAt === true && { joinedAt }) };
  if (dt === 0 && sg === 0) return totalMs === 0 ? { ...base, kind: 'clear', detail: {} } : { ...base, kind: 'timePenalty', detail: { totalMs } };
  const detail = { driveThroughs: dt, stopGos: sg, infringement: known(7, at), totalMs };
  return { ...base, kind: dt > 0 ? 'driveThroughPending' : 'stopGoPending', detail };
};

/** A car's penalties spans: clear from 0 (the engine joined so), then what it owes from each step on. */
export const owes = (car: number, steps: Owed[]): Array<Span | OpenSpan> =>
  chain('penalties', car, [owedStep({ at: 0, joinedAt: true }), ...steps.map(owedStep)]);

/** The race of a grand prix: the weekend phase the tests run in unless they say otherwise (C14). */
export const RACE: WeekendPhase = { kind: 'race', format: 'grandPrix' };

/** The weekend-phase span open for `phase` (none while `pending`), as the machine holds it (C14, C20). */
const weekendPhaseSpans = (phase: WeekendPhase): OpenSpan[] => {
  if (phase.kind === 'pending') return [];
  const { kind, ...detail } = phase;
  return [{ machine: 'weekend-phase', id: 0, kind, start: 0, confirmed: true, detail: kind === 'none' ? undefined : detail, startFrame: 1 }];
};

export type RaceInput = {
  miniSectors: MiniSectorCrossing[];
  events?: RaceEvent[];
  /** The session-phase spans closed in the projection (`neutralisation` builds them, C20). */
  phases?: Span[];
  /** Spans of any sub-machine, closed (in the projection) or open (in the situation), C20: `chain` and its helpers build them. */
  spans?: Array<Span | OpenSpan>;
  pitStops?: PitStopRecord[];
  laps?: LapRecord[];
  /** A `damage` output in the view; `incidents` must not read it (a log reads the history only). */
  damage?: DamageOutput;
  /** A `gaps` output in the view (only the fields a test sets); `incidents` must not read it either. */
  gaps?: Partial<GapsOutput>;
  playerCar?: number;
  config?: Record<string, number | boolean>;
  /** Config of the `alarms` section (the warnings before a penalty). */
  alarmsConfig?: Record<string, number | boolean>;
  /** Config of the `damage` section (the jump grouping's `jumpPct` and `jumpWindowMs`). */
  damageConfig?: Record<string, number | boolean>;
  /** The weekend phase (`view.situation.weekendPhase` and its open span, C14); a grand prix race by default. */
  weekendPhase?: WeekendPhase;
  /** Merged onto the race session on `TRACK`. */
  session?: Partial<SessionState>;
  /** The session-phase span open in the situation (`openNeutralisation`), not yet in `phases` (C20). */
  open?: OpenSpan;
};

/**
 * A race view over this history, everything new; upstream outputs only where given. The closed spans (`phases` and the
 * closed ones of `spans`) are in the projection by machine in closing order, the open ones (`open`, the open ones of
 * `spans` and the weekend phase's) in the situation.
 */
export function viewOf({
  miniSectors,
  events = [],
  phases = [],
  spans: given = [],
  pitStops = [],
  laps = [],
  damage,
  gaps,
  playerCar = PLAYER,
  config = {},
  alarmsConfig = {},
  damageConfig = {},
  weekendPhase = RACE,
  session = {},
  open,
}: RaceInput): EngineView {
  const outputs = new Map<string, unknown>();
  if (damage) outputs.set(DAMAGE, damage);
  if (gaps) outputs.set(GAPS, gaps);
  const last = miniSectors[miniSectors.length - 1];
  const all = [...phases, ...given, ...(open ? [open] : []), ...weekendPhaseSpans(weekendPhase)];
  const closed: Record<MachineId, Span[]> = {};
  const byMachine: Record<MachineId, OpenSpan[]> = {};
  for (const span of all) {
    if (isClosedSpan(span)) (closed[span.machine] ??= []).push(span);
    else (byMachine[span.machine] ??= []).push(span);
  }
  for (const list of Object.values(closed)) list.sort((a, b) => a.endFrame - b.endFrame);
  return engineView({
    situation: { weekendPhase, byMachine },
    history: { crossings: miniSectors, events, spans: closed, pitStops, laps },
    outputs,
    playerCar,
    config: { incidents: config, alarms: alarmsConfig, damage: damageConfig },
    session: { ...TRACK, ...session },
    sessionTime: last?.at ?? 0,
  });
}

/** `init` over the view, as on a fresh run, through the guarded view. */
export const run = (view: EngineView): IncidentsOutput => incidents.output(incidents.init(view));

/** The delta from one view's history to the next one's. */
export const deltaOf = (from: EngineView, to: EngineView, rewound = false) => ({
  before: projectionLengths(from.history),
  after: projectionLengths(to.history),
  ...(rewound ? { rewound: { frameId: -1, at: 0 } } : {}),
});

/** `init` over the first view, then `update` through the rest, as the scheduler does, through the guarded view. */
export function runSteps(views: EngineView[]): IncidentsOutput {
  const [first, ...rest] = views;
  if (!first) throw new Error('runSteps: no view');
  let acc = incidents.init(first);
  let prev = first;
  for (const view of rest) {
    acc = incidents.update(acc, deltaOf(prev, view), view);
    prev = view;
  }
  return incidents.output(acc);
}

/** A healthy car's damage state with the given jumps. */
export function damageState(jumps: DamageState['jumps']): DamageState {
  const none = known(0, 0);
  const corner = { tyrePct: none, brakePct: none };
  return {
    parts: known(
      { frontLeftWingPct: 0, frontRightWingPct: 0, rearWingPct: 0, floorPct: 0, diffuserPct: 0, sidepodPct: 0, gearboxPct: 0, enginePct: 0 },
      0,
    ),
    corners: { fl: corner, fr: corner, rl: corner, rr: corner },
    drsFault: known(false, 0),
    ersFault: false,
    jumps,
  };
}

/** A green-flag pit stop record of a car (a fact of the projection, with no frames of its pit-lane entry: C26). */
export const pitStop = (id: CarId, lap: number, pitLaneEntry: number, pitLaneExit: number): PitStopRecord => ({
  carId: id,
  lap,
  pitLaneEntry,
  pitLaneExit,
  pitLaneTimeMs: pitLaneExit - pitLaneEntry,
  stationaryTimeMs: 2_500,
  flag: 'green',
  penaltyServed: false,
  frame: 0,
});
