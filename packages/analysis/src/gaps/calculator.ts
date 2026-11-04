// The `gaps` calculator (spec 6.1): a fold over the mini-sector crossings; the order and our cars come from the car state.
import { carStatusSpans, known, MINI_SECTORS, sessionPhaseRaceSpans, unknown, type CarId, type Interval, type Known, type MiniSectorCrossing, type Ms, type Neighbourhood, type SessionTime } from '@pitwall/domain';
import type { EngineView, IncrementalCalculator } from '@pitwall/engine/readers';
import { behaviourByCar, behaviourFor, openSpansByCar } from '../shared/behaviour.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { isClosed, NEUTRALISATION_READS, neutralisationKind, neutralisedSpans, type NeutralisationKind } from '../shared/neutralised.ts';
import { ourCars } from '../shared/our-cars.ts';
import { gapBehind, lapsBehind, latestTime, progressAt, progressOf, recentOf, type CarCrossings } from './gaps.ts';
import { GAPS, GAPS_BEHAVIOUR, GAPS_CONFIG, type GapsOutput } from './index.ts';

/** What the crossings and events so far add up to. */
type Table = {
  /** By car id: every crossing, from progress 0. */
  tracks: Array<CarCrossings | undefined>;
  lineTimes: GapsOutput['lineTimes'];
  recent: GapsOutput['recent'];
  /** The race start (`RaceStart`) once a `racing` span of the race session phase has closed. */
  raceStart: RaceStart | undefined;
  /** The closed spans of the race session phase folded so far. */
  raceSpansFolded: number;
  /** The kind of the last closed span of the race session phase: the one before the open span. */
  lastRaceSpanKind: string | undefined;
};

/** The start of the first `racing` span of the race, and whether lights out was seen before it, so the start is known (C3). */
type RaceStart = { at: SessionTime; lightsOutSeen: boolean };

const NOT_APPLICABLE = unknown('notApplicable');

/** The car-status rows alone: a car's standing (C17, C43). */
const STATUS_BEHAVIOUR = { 'car-status': GAPS_BEHAVIOUR['car-status'] } as typeof GAPS_BEHAVIOUR;

/**
 * Adds the crossings from index `from` on. `lineTimes` and `recent` are replaced, never changed, as earlier
 * outputs hold them: one new `recent` window per car that crossed something.
 */
function foldCrossings(acc: Table, view: EngineView, from: number): void {
  const list = view.history.crossings;
  const length = list.length;
  if (from >= length) return;
  let lineTimes = acc.lineTimes;
  /** By car id: the car crossed something. */
  const crossed: boolean[] = [];
  for (let i = from; i < length; i++) {
    const m = list[i] as MiniSectorCrossing;
    const progress = progressOf(m);
    if (progress < 0) continue; // laps count from 1
    const track = (acc.tracks[m.carId] ??= { fromProgress: 0, at: [] });
    track.at[progress] = m.at;
    if (track.at.length > progress + 1) track.at.length = progress + 1; // a car that went back drops what lay ahead
    crossed[m.carId] = true;
    // segment 0 is the line at the start of its lap: it completes the lap before (none for lap 1, the start)
    const completed = m.lap - 1;
    if (m.segment === 0 && completed >= 1) {
      if (lineTimes === acc.lineTimes) lineTimes = { ...lineTimes };
      lineTimes[m.carId] = [...(lineTimes[m.carId] ?? []).filter((l) => l.lap < completed), { lap: completed, at: m.at }];
    }
  }
  const recent = { ...acc.recent };
  crossed.forEach((_, id) => (recent[id as CarId] = recentOf(acc.tracks[id] as CarCrossings)));
  acc.lineTimes = lineTimes;
  acc.recent = recent;
}

const RACE_PHASE = sessionPhaseRaceSpans.machine;

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

/** The race-only parts apply: every row of the weekend phase and the session phases open now says so (C14, C44); none open yet: they do not. */
const raceOnly = (view: EngineView): boolean => {
  const rows = behaviourFor(GAPS_BEHAVIOUR, view).flatMap((row) => ('race' in row ? [row.race] : []));
  return rows.length > 0 && rows.every(Boolean);
};

const raceStartAt = (start: RaceStart | undefined, race: boolean): Known<SessionTime> => {
  if (!race) return NOT_APPLICABLE;
  return start === undefined || !start.lightsOutSeen ? unknown('notReceived') : known(start.at, start.at);
};

/** The gap of `a` to the car ahead of it in the order: the time since that car passed where `a` is now. */
const roadGap = (a: CarCrossings | undefined, ahead: CarCrossings | undefined): Known<Ms> =>
  gapBehind(a, ahead, a === undefined || ahead === undefined ? 0 : lapsBehind(a, ahead));

const leaderGap = (leader: CarCrossings | undefined): Known<Ms> => {
  const at = leader === undefined ? undefined : latestTime(leader);
  return at === undefined ? unknown('notReceived') : known(0, at);
};

/** Grid position minus position; the grid position is 0 until the first LapData (the engine counts it from 1). */
const positionsGained = (timing: { gridPosition: number; position: number }, race: boolean, view: EngineView): Known<number> => {
  if (!race) return NOT_APPLICABLE;
  if (timing.gridPosition === 0) return unknown('notReceived');
  return known(timing.gridPosition - timing.position, view.live.sessionTime);
};

/** A neutralised phase: its end `undefined` while it is open. */
type Phase = { kind: NeutralisationKind; start: SessionTime; end: SessionTime | undefined };

/** The race's neutralisations (`shared/neutralised.ts`: closed in the projection, then the open one, C20), as phases. */
const neutralisedPhases = (view: EngineView): Phase[] =>
  neutralisedSpans(view.history, view.situation).map((span) => ({
    kind: neutralisationKind(span),
    start: span.start,
    end: isClosed(span) ? span.end : undefined,
  }));

/** The leader's progress in laps at `t`: the furthest crossing of any car by then, / 50 (the race start before any). */
const leaderLapAt = (acc: Table, t: SessionTime): number => {
  let furthest = 0;
  for (const track of acc.tracks) {
    const progress = track === undefined ? undefined : progressAt(track, t);
    if (progress !== undefined && progress > furthest) furthest = progress;
  }
  return furthest / MINI_SECTORS;
};

/** The phases on the gapper's x: the leader's progress at their start and end. */
const phasesOf = (acc: Table, race: boolean, view: EngineView): GapsOutput['phases'] => {
  if (!race) return [];
  return neutralisedPhases(view).map(({ kind, start, end }) => ({
    kind,
    fromLap: leaderLapAt(acc, start),
    toLap: end === undefined ? NOT_APPLICABLE : known(leaderLapAt(acc, end), end),
  }));
};

/** The running cars in position order (ties by id), their intervals, the cars around each of ours, and the cars out of the race. */
function build(acc: Table, view: EngineView): GapsOutput {
  const race = raceOnly(view);
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

  const { neighbourhoodMs } = GAPS_CONFIG.read(view);
  const near = (gap: Known<Ms>) => gap.known && Math.abs(gap.value) <= neighbourhoodMs;
  const neighbourhood: Neighbourhood[] = [];
  for (const ourCarId of ourCars(view.live)) {
    const at = order.indexOf(ourCarId);
    if (at < 0) continue;
    const carIds = order.filter((_, j) => j !== at && (Math.abs(j - at) <= 1 || near(gapBehind(tracks[j], tracks[at]))));
    neighbourhood.push({ ourCarId, carIds });
  }

  return {
    intervals,
    lineTimes: acc.lineTimes,
    recent: acc.recent,
    neighbourhood,
    raceStartAt: raceStartAt(raceStartNow(acc, view), race),
    outOfRace: outOfRace.sort((a, b) => a - b),
    phases: phasesOf(acc, race, view),
  };
}

const init = (view: EngineView): Table => {
  const table: Table = { tracks: [], lineTimes: {}, recent: {}, raceStart: undefined, raceSpansFolded: 0, lastRaceSpanKind: undefined };
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
