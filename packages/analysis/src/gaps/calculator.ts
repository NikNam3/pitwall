// The `gaps` calculator (spec 6.1): a fold over the mini-sector crossings; the order and our cars come from the car state.
import { carStatusSpans, foldCurrentCrossing, known, weekendPhaseSpans, MINI_SECTORS, sessionPhaseRaceSpans, unknown, type CarId, type CrossingIndex, type FrameNumber, type Interval, type Known, type MachineId, type MiniSectorCrossing, type Ms, type Neighbourhood, type SessionTime } from '@pitwall/domain';
import { membershipOf, openSpansOf, type EngineView, type IncrementalCalculator, type MembershipSource } from '@pitwall/engine/readers';
import { behaviourByCar, behaviourFor, openSpansByCar } from '../shared/behaviour.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { isClosed, NEUTRALISATION_READS, neutralisationKind, neutralisedSpans, type Neutralisation } from '../shared/neutralised.ts';
import { ourCars } from '@pitwall/domain';
import { fineOf, gapBehind, lapsBehind, latestTime, progressOf, recentOf, type CarCrossings } from './gaps.ts';
import { GAPS, GAPS_BEHAVIOUR, GAPS_CONFIG, type GapsOutput } from './index.ts';
import type { GapsPhase } from './output.ts';
import { clearCrossingTimes, emptyCrossingTimes, emptyWindow, judgeCrossing, othersInWindow, setCrossingTime, windowThresholds, type CrossingTimes, type GapperWindow } from './window.ts';

/** What the crossings and events so far add up to. */
type Table = {
  /** The current crossing of every car, lap and segment (C25: folded through the domain helper). */
  current: CrossingIndex;
  /** By car id: every crossing, from progress 0. */
  tracks: Array<CarCrossings | undefined>;
  /** The same times as `tracks`, dense, for the window judge. */
  times: CrossingTimes;
  lineTimes: GapsOutput['lineTimes'];
  recent: GapsOutput['recent'];
  fine: GapsOutput['fine'];
  /** Who is near whom, judged at each crossing: the gapper's window of every set of cars that may be ours. */
  window: GapperWindow;
  /** The race start (`RaceStart`) once a `racing` span of the race session phase has closed. */
  raceStart: RaceStart | undefined;
  /** The closed spans of the race session phase folded so far. */
  raceSpansFolded: number;
  /** The kind of the last closed span of the race session phase: the one before the open span. */
  lastRaceSpanKind: string | undefined;
  /** The first closed span of the race session phase: whether the engine joined the race in it (`joinedAt`). */
  firstRaceSpan: FirstSpan | undefined;
  /** The furthest progress any car has crossed; -1 before any crossing. */
  furthest: number;
  /** The crossings that led the road (each further than every one before it), in the projection's order: the leader's progress by frame. */
  leaders: RoadLeader[];
  /** By car id: the progress of its first crossing (the first after the join). */
  firstProgress: Array<number | undefined>;
  /** The leader's first line crossing after the join (`JoinLine`), once one is known. */
  joinLine: JoinLine | undefined;
};

/** A crossing that led the road: the frame it describes (C26) and its progress. */
type RoadLeader = { frame: FrameNumber; progress: number };

/** A span of the race session phase as the join reads it: its kind and whether the engine joined in it. */
type FirstSpan = { kind: string; joinedAt: boolean };

/** A line crossing of the leader on the road: `lap` its completed laps there, at `progress` (`lap × 50`), when. */
type JoinLine = { lap: number; progress: number; at: SessionTime };

/** The start of the first `racing` span of the race, and whether lights out was seen before it, so the start is known (C3). */
type RaceStart = { at: SessionTime; lightsOutSeen: boolean };

const NOT_APPLICABLE = unknown('notApplicable');

/** The car-status rows alone: a car's standing (C17, C43). */
const STATUS_BEHAVIOUR = { 'car-status': GAPS_BEHAVIOUR['car-status'] } as typeof GAPS_BEHAVIOUR;

/**
 * Adds the crossings from index `from` on. `lineTimes`, `recent` and `fine` are replaced, never changed, as earlier
 * outputs hold them: one new `recent` and `fine` window per car that crossed something. Each crossing judges its car's
 * gap to every car that passed the same point before it (the gapper's window).
 */
function foldCrossings(acc: Table, view: EngineView, from: number): void {
  const list = view.history.crossings;
  const length = list.length;
  if (from >= length) return;
  const config = GAPS_CONFIG.read(view);
  const { fineLaps } = config;
  const thresholds = windowThresholds(config);
  let lineTimes = acc.lineTimes;
  /** By car id: the car crossed something. */
  const crossed: boolean[] = [];
  // the helpers as locals: the loop below runs once per crossing of the race
  const [fold, progressAt, judge, setTime] = [foldCurrentCrossing, progressOf, judgeCrossing, setCrossingTime];
  for (let i = from; i < length; i++) {
    const m = list[i] as MiniSectorCrossing;
    const progress = progressAt(m);
    if (progress < 0) continue; // laps count from 1
    const track = (acc.tracks[m.carId] ??= { fromProgress: 0, at: [] });
    fold(acc.current, m); // m is now its car's, lap's and segment's current crossing (C25)
    const at = m.at;
    track.at[progress] = at;
    if (track.at.length > progress + 1) {
      // a car that went back drops what lay ahead
      clearCrossingTimes(acc.times, m.carId, progress + 1, track.at.length);
      track.at.length = progress + 1;
    }
    setTime(acc.times, m.carId, progress, at);
    crossed[m.carId] = true;
    foldJoinLine(acc, m, progress);
    judge(acc.window, acc.times, m.carId, progress, at, thresholds);
    // segment 0 is the line at the start of its lap: it completes the lap before (none for lap 1, the start)
    const completed = m.lap - 1;
    if (m.segment === 0 && completed >= 1) {
      if (lineTimes === acc.lineTimes) lineTimes = { ...lineTimes };
      lineTimes[m.carId] = [...(lineTimes[m.carId] ?? []).filter((l) => l.lap < completed), { lap: completed, at: m.at }];
    }
  }
  const recent = { ...acc.recent };
  const fine = { ...acc.fine };
  crossed.forEach((_, id) => {
    const track = acc.tracks[id] as CarCrossings;
    recent[id as CarId] = recentOf(track);
    fine[id as CarId] = fineOf(track, fineLaps);
  });
  acc.lineTimes = lineTimes;
  acc.recent = recent;
  acc.fine = fine;
}

/**
 * The leader's first line crossing after the join, crossing by crossing (a pure fold over the crossings, C31.2; the
 * engine records none before it joined). A car's first crossing after the join at progress p means it was at p − 1
 * then, so the leader then was at the most of those; a line crossing that is the furthest progress yet is the leader's
 * on the road, and it is the leader's first after the join unless a car seen later first crossed beyond it (it led the
 * road unseen at the join): then the next such line crossing is.
 */
function foldJoinLine(acc: Table, m: MiniSectorCrossing, progress: number): void {
  if (acc.firstProgress[m.carId] === undefined) {
    acc.firstProgress[m.carId] = progress;
    if (acc.joinLine !== undefined && progress > acc.joinLine.progress) acc.joinLine = undefined;
  }
  if (progress <= acc.furthest) return;
  acc.furthest = progress;
  acc.leaders.push({ frame: m.frame, progress });
  // segment 0 is the line at the start of its lap: it completes the lap before (none for lap 1, the start)
  if (acc.joinLine === undefined && m.segment === 0 && m.lap >= 2) acc.joinLine = { lap: m.lap - 1, progress, at: m.at };
}

const RACE_PHASE = sessionPhaseRaceSpans.machine;

/** The race session phases before lights out: a race joined in one of them sees the lights go out. */
const BEFORE_LIGHTS_OUT: readonly string[] = ['grid', 'formation', 'startLights'];

/**
 * The race start of a `racing` span (C26): its start, known only if it directly follows a `startLights` span (or opens
 * the machine without `joinedAt`), i.e. the engine saw lights out (C3); a race joined later (under a safety car, say)
 * has none.
 */
const raceStartOf = (span: { start: SessionTime; joinedAt?: boolean }, before: string | undefined): RaceStart => ({
  at: span.start,
  // a `racing` span with nothing before it that was not joined opened with the machine: lights out was seen
  lightsOutSeen: before === undefined ? span.joinedAt !== true : before === 'startLights',
});

/** Folds the closed spans of the race session phase not folded yet; the race start is fixed once its first `racing` span closed. */
function foldRaceSpans(acc: Table, view: EngineView): void {
  const spans = view.history.spans[RACE_PHASE] ?? [];
  for (let i = acc.raceSpansFolded; i < spans.length; i++) {
    const span = spans[i] as (typeof spans)[number];
    acc.firstRaceSpan ??= { kind: span.kind, joinedAt: span.joinedAt === true };
    if (acc.raceStart === undefined && span.kind === 'racing') acc.raceStart = raceStartOf(span, acc.lastRaceSpanKind);
    acc.lastRaceSpanKind = span.kind;
  }
  acc.raceSpansFolded = spans.length;
}

/** The race start: from the closed spans (the fold), else from the open `racing` span after the last closed one (C20). */
const raceStartNow = (acc: Table, view: EngineView): RaceStart | undefined => {
  if (acc.raceStart !== undefined) return acc.raceStart;
  const open = (view.situation.byMachine[RACE_PHASE] ?? []).find((s) => s.kind === 'racing');
  return open === undefined ? undefined : raceStartOf(open, acc.lastRaceSpanKind);
};

/**
 * Whether the race-only parts apply: `pending` while no weekend-phase span is open yet (C14: the phase is not known, so
 * they are `notReceived`, C3); else `race` when every row of the weekend phase and the session phases open now says so
 * (C44), `other` when one does not.
 */
type RaceParts = 'race' | 'other' | 'pending';

const racePartsOf = (view: EngineView): RaceParts => {
  if (openSpansOf(view, weekendPhaseSpans.machine).length === 0) return 'pending';
  const rows = behaviourFor(GAPS_BEHAVIOUR, view).flatMap((row) => ('race' in row ? [row.race] : []));
  return rows.length > 0 && rows.every(Boolean) ? 'race' : 'other';
};

/** A race-only part where it does not apply: `notReceived` while the weekend phase is pending, else `notApplicable`. */
const notRace = (race: Exclude<RaceParts, 'race'>): Known<never> => (race === 'pending' ? unknown('notReceived') : NOT_APPLICABLE);

const raceStartAt = (start: RaceStart | undefined, race: RaceParts): Known<SessionTime> => {
  if (race !== 'race') return notRace(race);
  return start === undefined || !start.lightsOutSeen ? unknown('notReceived') : known(start.at, start.at);
};

/** The first span of the race session phase: the first closed one (the fold), else the open one (C20). */
const firstRaceSpanNow = (acc: Table, view: EngineView): FirstSpan | undefined => {
  if (acc.firstRaceSpan !== undefined) return acc.firstRaceSpan;
  const open = (view.situation.byMachine[RACE_PHASE] ?? [])[0];
  return open === undefined ? undefined : { kind: open.kind, joinedAt: open.joinedAt === true };
};

/**
 * Where the gapper starts (C3): lights out when the engine saw it; else, in a race the engine joined after lights out
 * (its first `racing` span not after start lights, or its first span joined past them), the leader's first line
 * crossing after the join; `notReceived` until one is known.
 */
function originOf(acc: Table, view: EngineView, start: RaceStart | undefined, race: RaceParts): GapsOutput['origin'] {
  if (race !== 'race') return notRace(race);
  if (start?.lightsOutSeen === true) return known({ kind: 'lightsOut', at: start.at }, start.at);
  const first = firstRaceSpanNow(acc, view);
  const joined = start !== undefined || (first !== undefined && first.joinedAt && !BEFORE_LIGHTS_OUT.includes(first.kind));
  const line = acc.joinLine;
  if (!joined || line === undefined) return unknown('notReceived');
  return known({ kind: 'join', lap: line.lap, at: line.at }, line.at);
}

/** The leader's lap and the part of it crossed, from its newest crossing; `notReceived` before it has one (C3). */
function leaderProgressOf(leader: CarCrossings | undefined): GapsOutput['leaderProgress'] {
  const at = leader === undefined ? undefined : latestTime(leader);
  if (leader === undefined || at === undefined) return unknown('notReceived');
  const progress = leader.fromProgress + leader.at.length - 1;
  return known({ lap: Math.floor(progress / MINI_SECTORS) + 1, fraction: (progress % MINI_SECTORS) / MINI_SECTORS }, at);
}

/** The gap of `a` to the car ahead of it in the order: the time since that car passed where `a` is now. */
const roadGap = (a: CarCrossings | undefined, ahead: CarCrossings | undefined): Known<Ms> =>
  gapBehind(a, ahead, a === undefined || ahead === undefined ? 0 : lapsBehind(a, ahead));

const leaderGap = (leader: CarCrossings | undefined): Known<Ms> => {
  const at = leader === undefined ? undefined : latestTime(leader);
  return at === undefined ? unknown('notReceived') : known(0, at);
};

/** Grid position minus position; the grid position is 0 until the first LapData (the engine counts it from 1). */
const positionsGained = (timing: { gridPosition: number; position: number }, race: RaceParts, view: EngineView): Known<number> => {
  if (race !== 'race') return notRace(race);
  if (timing.gridPosition === 0) return unknown('notReceived');
  return known(timing.gridPosition - timing.position, view.live.sessionTime);
};

/** The span bounds membership reads (C26): an open span has no `endFrame`. */
type Bounds = { machine: MachineId; startFrame: FrameNumber; endFrame?: FrameNumber };

/**
 * Whether the projection module puts a fact on `frame` inside the span `bounds` (C26: `membershipOf`, never judged here),
 * asked of a source holding that one span alone, so it reads nothing else of the projection.
 */
const inside = (bounds: Bounds, frame: FrameNumber): boolean => {
  const source = { history: { spans: { [bounds.machine]: [bounds] } } } as unknown as MembershipSource;
  return membershipOf(source, { frame })[bounds.machine] !== undefined;
};

/** The first index of `leaders` from `from` on for which `test` holds, `test` false then true along them; `leaders.length` if none. */
const firstWhere = (leaders: readonly RoadLeader[], from: number, test: (l: RoadLeader) => boolean): number => {
  let lo = from;
  let hi = leaders.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (test(leaders[mid] as RoadLeader)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
};

/**
 * A neutralisation on the leader's progress, by its crossings' membership (C26): `fromLap` at the leader's first crossing
 * inside the span, `toLap` at its last one inside it (`notApplicable` while open). The road-leading crossings are in
 * frame order, so those inside the span are one run of them: the first is the first at or after its opening frame (the
 * span taken as still open), the run ends at the first one outside it. A span with none inside lies where the leader
 * was as it opened.
 */
function phaseOf(acc: Table, span: Neutralisation): GapsPhase {
  const leaders = acc.leaders;
  const bounds: Bounds = { machine: span.machine, startFrame: span.startFrame, ...(isClosed(span) ? { endFrame: span.endFrame } : {}) };
  const fromOpening = { machine: span.machine, startFrame: span.startFrame };
  const first = firstWhere(leaders, 0, (l) => inside(fromOpening, l.frame));
  const before = first === 0 ? 0 : (leaders[first - 1] as RoadLeader).progress;
  const entered = first < leaders.length && inside(bounds, (leaders[first] as RoadLeader).frame);
  const fromLap = (entered ? (leaders[first] as RoadLeader).progress : before) / MINI_SECTORS;
  let toLap: Known<number> = NOT_APPLICABLE;
  if (isClosed(span)) {
    const last = entered ? firstWhere(leaders, first, (l) => !inside(bounds, l.frame)) - 1 : -1;
    toLap = known((last >= 0 ? (leaders[last] as RoadLeader).progress : before) / MINI_SECTORS, span.end);
  }
  return { kind: neutralisationKind(span), fromLap, toLap, span: { machine: span.machine, id: span.id } };
}

/** The phases on the gapper's x: the race's neutralisations (`shared/neutralised.ts`: closed, then the open one, C20). */
const phasesOf = (acc: Table, race: RaceParts, view: EngineView): GapsOutput['phases'] =>
  race !== 'race' ? [] : neutralisedSpans(view.history, view.situation).map((span) => phaseOf(acc, span));

/** The running cars in position order (ties by id), their intervals, the cars around each of ours, and the cars out of the race. */
function build(acc: Table, view: EngineView): GapsOutput {
  const race = racePartsOf(view);
  // only the cars car-status has a span open for can stand in the order: the other slots are not read
  const statusRows = behaviourByCar(STATUS_BEHAVIOUR, view);
  const running: (typeof view.live.cars)[number][] = [];
  const outOfRace: CarId[] = [];
  for (const id of openSpansByCar(view, carStatusSpans.machine).keys()) {
    const car = view.live.cars[id];
    if (car === undefined) continue;
    let standing: 'running' | 'out' | undefined;
    for (const row of statusRows(id)) if ('car' in row && row.car !== 'absent') standing = row.car;
    if (standing === 'running') running.push(car);
    else if (standing === 'out') outOfRace.push(id); // out of the race: no gaps, no neighbour
  }
  running.sort((a, b) => a.timing.position - b.timing.position || a.id - b.id);
  const order = running.map((c) => c.id);
  const tracks = order.map((id) => acc.tracks[id]);
  const leader = tracks[0];
  const toAhead = tracks.map((track, i) => (i === 0 ? NOT_APPLICABLE : roadGap(track, tracks[i - 1])));
  const intervals: Interval[] = running.map(({ id, timing }, i) => {
    const track = tracks[i];
    const lapsDown = track === undefined || leader === undefined ? 0 : lapsBehind(track, leader);
    return {
      carId: id,
      toLeaderMs: i === 0 ? leaderGap(track) : gapBehind(track, leader, lapsDown),
      toAheadMs: toAhead[i] ?? NOT_APPLICABLE,
      toBehindMs: toAhead[i + 1] ?? NOT_APPLICABLE,
      lapsDown,
      positionsGained: positionsGained(timing, race, view),
    };
  });

  const start = raceStartNow(acc, view);
  const { neighbourhoodMs } = GAPS_CONFIG.read(view);
  const near = (gap: Known<Ms>) => gap.known && Math.abs(gap.value) <= neighbourhoodMs;
  const neighbourhood: Neighbourhood[] = [];
  const ours = ourCars(view.live);
  for (const ourCarId of ours) {
    const at = order.indexOf(ourCarId);
    if (at < 0) continue;
    const carIds = order.filter((_, j) => j !== at && (Math.abs(j - at) <= 1 || near(gapBehind(tracks[j], tracks[at]))));
    neighbourhood.push({ ourCarId, carIds });
  }

  return {
    intervals,
    lineTimes: acc.lineTimes,
    recent: acc.recent,
    fine: acc.fine,
    gapperWindow: { ours, others: othersInWindow(acc.window, ours) },
    neighbourhood,
    raceStartAt: raceStartAt(start, race),
    outOfRace: outOfRace.sort((a, b) => a - b),
    phases: phasesOf(acc, race, view),
    leaderProgress: leaderProgressOf(leader),
    origin: originOf(acc, view, start, race),
  };
}

const init = (view: EngineView): Table => {
  const table: Table = {
    current: new Map(),
    tracks: [],
    times: emptyCrossingTimes(),
    lineTimes: {},
    recent: {},
    fine: {},
    window: emptyWindow(),
    raceStart: undefined,
    raceSpansFolded: 0,
    lastRaceSpanKind: undefined,
    firstRaceSpan: undefined,
    furthest: -1,
    leaders: [],
    firstProgress: [],
    joinLine: undefined,
  };
  foldCrossings(table, view, 0);
  foldRaceSpans(table, view);
  return table;
};

/**
 * Every gap from the crossings, kept up to date crossing by crossing: each new crossing is one table write (a pure fold
 * over the projection, C31.2), and the output is built from the table, the car state and the open spans in O(cars),
 * plus a binary search per car and phase. A flashback starts over.
 */
export const gapsCalculator: IncrementalCalculator<Table, GapsOutput> = {
  id: GAPS,
  kind: 'incremental',
  reads: ['miniSectors', 'timing', 'identity', 'spans:weekend-phase', CAR_STATUS_READS, ...NEUTRALISATION_READS],
  cadence: 'frame',
  init,
  update(acc, delta, view) {
    if (delta.rewound !== undefined) return init(view);
    foldCrossings(acc, view, delta.before.crossings ?? 0);
    foldRaceSpans(acc, view);
    return acc;
  },
  output: build,
};
