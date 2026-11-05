// Test scenes for `battle` (spec 3.1 of the live polish design): cars' mini-sector crossings in the engine's convention,
// the spans battle reads and the `gaps` output it takes its neighbours and gaps from. Crossing (L, s) is boundary `s` of
// lap L; segment s of lap L runs from (L, s) to (L, s + 1), or to (L + 1, 0) for s = 49. Each crossing describes the frame
// numbered as its time (`frame = at`), and so does every span (`startFrame = start`), so frames and times keep one order
// (C26). Every test runs the calculator through its guarded view (C41).
import {
  carId,
  known,
  MINI_SECTORS,
  type CarId,
  type CarState,
  type DrsOffReason,
  type Interval,
  type Known,
  type MachineId,
  type MiniSectorCrossing,
  type Ms,
  type OpenSpan,
  type Span,
} from '@pitwall/domain';
import { projectionLengths, type EngineView, type HistoryDelta } from '@pitwall/engine';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { carState, engineView, neutralisation, openNeutralisation, RACE_PHASES, realismHidden, type DeepPartial } from '../../../../test-support/builders/index.ts';
import { battleCalculator } from '../../src/battle/calculator.ts';
import { BATTLE, type BattleOutput } from '../../src/battle/index.ts';
import type { GapsOutput } from '../../src/gaps/index.ts';

export const id = (n: number): CarId => carId(n);

/** How long segment `segment` of lap `lap` takes a car, in ms. */
export type SegmentMs = (lap: number, segment: number) => number;

/** A car's run: it crosses (1, 0) at `startAt`, then every boundary after the segment before it, each `ms` long. */
export type Run = { startAt: number; ms: SegmentMs };

/** The laps a run is built for; a scene keeps the crossings up to its `now`. */
const LAPS = 9;

/** Segment `(lap, segment)` as its count of segments from (1, 0). */
const indexOf = (lap: number, segment: number): number => (lap - 1) * MINI_SECTORS + segment;

/** The time car `run` crosses boundary `(lap, segment)`. */
export function crossingAt(run: Run, lap: number, segment: number): number {
  let at = run.startAt;
  for (let i = 0; i < indexOf(lap, segment); i++) at += run.ms(Math.floor(i / MINI_SECTORS) + 1, i % MINI_SECTORS);
  return at;
}

/** Every crossing of `run` for car `car` up to `until`, in order. */
export function crossingsOf(car: number, run: Run, until: number): MiniSectorCrossing[] {
  const list: MiniSectorCrossing[] = [];
  let at = run.startAt;
  for (let i = 0; i <= LAPS * MINI_SECTORS && at <= until; i++) {
    const lap = Math.floor(i / MINI_SECTORS) + 1;
    const segment = i % MINI_SECTORS;
    list.push({ carId: id(car), lap, segment, at, frame: at });
    at += run.ms(lap, segment);
  }
  return list;
}

/** Segments `from..to` (both included) of lap `lap`, as `[lap, segment]` pairs. */
export const segments = (lap: number, from: number, to: number): Array<[number, number]> =>
  Array.from({ length: to - from + 1 }, (_, i): [number, number] => [lap, from + i]);

/**
 * PACE Δ over `window` as the spec defines it: their time minus ours over the same segments, normalised to one lap
 * (positive = we are faster). `theirLap` maps our lap to theirs (a car a lap ahead: `l + 1`).
 */
export function paceOver(window: ReadonlyArray<[number, number]>, ours: SegmentMs, theirs: SegmentMs, theirLap = (l: number) => l): number {
  const sum = window.reduce((total, [lap, segment]) => total + theirs(theirLap(lap), segment) - ours(lap, segment), 0);
  return (sum * MINI_SECTORS) / window.length;
}

/** A stretch of a car off the track (`car-location` `pitLane` unless `kind` says `garage`): closed with `to`, open (in the situation) without. */
export type PitLane = { car: number; from: number; to?: number; kind?: 'pitLane' | 'garage' };
/** A neutralisation of the race (`session-phase-race`): closed with `to`, open without; an SC by default. */
export type Neutralised = { kind?: 'SC' | 'VSC' | 'red'; from: number; to?: number; confirmed?: boolean };

type Drs = 'drsOn' | { off: DrsOffReason };

export type Scene = {
  /** The race clock now: every crossing at or before it is in the projection. */
  now: number;
  /** The cars' runs, by id. */
  runs: Record<number, Run>;
  /** The cars in the order of `gaps.intervals` (retired and disqualified cars are already left out there). */
  order: number[];
  /** Our gaps from `gaps.intervals`, by car: `toAheadMs` 1.6 s and `toBehindMs` 2.2 s unless given. */
  gaps?: Record<number, { toAheadMs?: Known<Ms>; toBehindMs?: Known<Ms> }>;
  pitLane?: PitLane[];
  neutralised?: Neutralised[];
  /** The weekend phase (`weekend-phase`'s open span); a race by default. */
  phase?: 'race' | 'practice' | 'qualifying' | 'none';
  /** Race control's DRS (`race-control-race`'s open span, C20); by default `drsOn`. `none`: no span open (outside a race). */
  drs?: Drs | 'none';
  /** The `race-control-race` spans closed before the open one. */
  closedDrs?: Span[];
  teammate?: number;
  hidden?: number[];
  /** Overrides of a car's state, by id. */
  carOver?: Record<number, DeepPartial<CarState>>;
  config?: EngineView['config'];
  /** No `gaps` output at all. */
  noGaps?: boolean;
};

const RC: MachineId = 'race-control-race';
const WP: MachineId = 'weekend-phase';
const LOCATION: MachineId = 'car-location';

/** An open span as `view.situation` holds it (C20). */
export const open = (machine: MachineId, n: number, kind: string, start = 0, over: Partial<OpenSpan> = {}): OpenSpan => ({
  machine,
  id: n,
  kind,
  start,
  startFrame: start,
  confirmed: true,
  detail: undefined,
  ...over,
});
/** A closed span of the projection. */
export const closed = (machine: MachineId, n: number, kind: string, start: number, end: number, over: Partial<Span> = {}): Span => ({
  ...open(machine, n, kind, start),
  end,
  endFrame: end,
  ...over,
});

/** A closed `race-control-race` span of the history. */
export const closedDrs = (n: number, drs: Drs, start: number, end: number): Span =>
  closed(RC, n, drs === 'drsOn' ? 'drsOn' : 'drsOff', start, end, { detail: drs === 'drsOn' ? undefined : { reason: drs.off } });

/** Each car's `car-location` spans: on track, then each stretch off it and on track after it; the open one last. */
function locationSpans(cars: number[], pits: readonly PitLane[]): { closed: Span[]; open: OpenSpan[] } {
  const done: Span[] = [];
  const now: OpenSpan[] = [];
  for (const car of cars) {
    const own = pits.filter((p) => p.car === car).sort((a, b) => a.from - b.from);
    let n = 0;
    let from = 0;
    let kind = 'track';
    for (const pit of own) {
      done.push(closed(LOCATION, n++, kind, from, pit.from, { carId: id(car) }));
      if (pit.to === undefined) {
        from = pit.from;
        kind = pit.kind ?? 'pitLane';
        break;
      }
      done.push(closed(LOCATION, n++, pit.kind ?? 'pitLane', pit.from, pit.to, { carId: id(car) }));
      from = pit.to;
    }
    now.push(open(LOCATION, n, kind, from, { carId: id(car) }));
  }
  return { closed: done.sort((a, b) => a.endFrame - b.endFrame), open: now };
}

/** The race's session phases: racing from 0, each neutralisation between racing spans; the open one last. */
function phaseSpans(list: readonly Neutralised[]): { closed: Span[]; open: OpenSpan } {
  const done: Span[] = [];
  let n = 0;
  let from = 0;
  for (const s of [...list].sort((a, b) => a.from - b.from)) {
    done.push(closed(RACE_PHASES, n++, 'racing', from, s.from));
    if (s.to === undefined) return { closed: done, open: openNeutralisation({ kind: s.kind ?? 'SC', start: s.from, id: n }) };
    done.push(neutralisation({ kind: s.kind ?? 'SC', start: s.from, end: s.to, id: n++, ...(s.confirmed !== undefined && { confirmed: s.confirmed }) }));
    from = s.to;
  }
  return { closed: done, open: open(RACE_PHASES, n, 'racing', from) };
}

const weekendPhaseOf = (phase: NonNullable<Scene['phase']>): EngineView['situation']['weekendPhase'] =>
  phase === 'none'
    ? { kind: 'none' }
    : phase === 'race'
      ? { kind: 'race', format: 'grandPrix' }
      : phase === 'practice'
        ? { kind: 'practice', format: 'practice', segment: undefined }
        : { kind: 'qualifying', format: 'grandPrix', segment: undefined };

/** The view of `s` at its `now`, unguarded. */
export function viewOf(s: Scene): EngineView {
  const ids = Object.keys(s.runs).map(Number);
  const crossings = ids
    .flatMap((n) => crossingsOf(n, s.runs[n]!, s.now))
    .sort((a, b) => a.at - b.at || a.carId - b.carId);
  const cars = s.order.map((n, i) => {
    const car = carState({ id: id(n), timing: { position: i + 1 }, ...s.carOver?.[n] });
    return s.hidden?.includes(n) ? realismHidden(car) : car;
  });
  const location = locationSpans(ids, s.pitLane ?? []);
  const phase = s.phase ?? 'race';
  const race = phase === 'race' ? phaseSpans(s.neutralised ?? []) : undefined;
  const drs = s.drs ?? 'drsOn';
  const spans: Record<MachineId, Span[]> = { [LOCATION]: location.closed };
  if (race !== undefined) spans[RACE_PHASES] = race.closed;
  if (s.closedDrs !== undefined) spans[RC] = s.closedDrs;
  const byMachine: Record<MachineId, OpenSpan[]> = {
    [WP]: [open(WP, 0, phase, 0, { detail: phase === 'none' ? undefined : { format: phase === 'practice' ? 'practice' : 'grandPrix' } })],
    [LOCATION]: location.open,
    ...(race !== undefined && { [RACE_PHASES]: [race.open] }),
    ...(phase !== 'race' && phase !== 'none' && { [`session-phase-${phase}`]: [open(`session-phase-${phase}`, 0, 'running')] }),
    ...(drs === 'none' ? {} : { [RC]: [drs === 'drsOn' ? open(RC, s.closedDrs?.length ?? 0, 'drsOn') : open(RC, s.closedDrs?.length ?? 0, 'drsOff', 0, { detail: { reason: drs.off } })] }),
  };
  const interval = (n: number): Interval => ({
    carId: id(n),
    toLeaderMs: known(0, s.now),
    toAheadMs: s.gaps?.[n]?.toAheadMs ?? known(1600, s.now),
    toBehindMs: s.gaps?.[n]?.toBehindMs ?? known(2200, s.now),
    lapsDown: 0,
    positionsGained: known(0, s.now),
  });
  // the fields battle may read; the rest of the output is not battle's business
  const gaps: Pick<GapsOutput, 'phases' | 'intervals' | 'lineTimes' | 'recent' | 'neighbourhood' | 'raceStartAt'> = {
    phases: [],
    intervals: s.order.map(interval),
    lineTimes: {},
    recent: {},
    neighbourhood: [],
    raceStartAt: known(0, 0),
  };
  const view = engineView({
    cars,
    sessionTime: s.now,
    history: { crossings, spans },
    situation: { weekendPhase: weekendPhaseOf(phase), byMachine },
    outputs: s.noGaps ? new Map() : new Map<string, unknown>([['gaps', gaps]]),
    ...(s.config && { config: s.config }),
  });
  return s.teammate === undefined ? view : { ...view, live: { ...view.live, teammateCar: id(s.teammate) } };
}

/** The view as the scheduler hands it to `battle`: through its guarded view, so a read it does not declare throws (C41). */
export const guarded = (view: EngineView): EngineView => guardedView(view, battleCalculator.reads, { unit: BATTLE });

/** The cards from scratch: `init` and `output` over the guarded view. */
export function cardsOf(view: EngineView): BattleOutput {
  const g = guarded(view);
  return battleCalculator.output(battleCalculator.init(g), g);
}

/** Our car's card (car 0 unless `n`), from scratch. */
export const cardOf = (s: Scene, n = 0) => cardsOf(viewOf(s))[id(n)]!;

/** The delta from one view's projection to the next one's; a rewind when `rewound` is given (C27, C30). */
export const deltaOf = (from: EngineView, to: EngineView, rewound?: { frameId: number; at: number }): HistoryDelta => ({
  before: projectionLengths(from.history),
  after: projectionLengths(to.history),
  ...(rewound && { rewound }),
});
