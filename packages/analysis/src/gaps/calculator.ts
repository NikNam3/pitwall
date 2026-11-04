// The `gaps` calculator (spec 6.1): a fold over the mini-sector crossings; the order and our cars come from the car state.
import { known, MINI_SECTORS, sessionPhaseRaceSpans, unknown, type CarId, type Interval, type Known, type Ms, type Neighbourhood, type SessionTime } from '@pitwall/domain';
import type { EngineView, IncrementalCalculator } from '@pitwall/engine/readers';
import { behaviourFor } from '../shared/behaviour.ts';
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
  /** The start of the first `racing` span of the race: the race start. */
  raceStart: SessionTime | undefined;
  /** The first `racing` span follows `startLights`: lights out was seen, so the start is known (C3). */
  lightsOutSeen: boolean;
};

type GapsAcc = Table & { out: GapsOutput };

const NOT_APPLICABLE = unknown('notApplicable');

/** The car-status rows alone: a car's standing (C17, C43). */
const STATUS_BEHAVIOUR = { 'car-status': GAPS_BEHAVIOUR['car-status'] } as typeof GAPS_BEHAVIOUR;

/**
 * Adds the crossings from index `from` on. `lineTimes` and `recent` are replaced, never changed, as earlier
 * outputs hold them: one new `recent` window per car that crossed something.
 */
function foldCrossings(acc: Table, view: EngineView, from: number): void {
  const list = view.history.crossings;
  if (from >= list.length) return;
  let lineTimes = acc.lineTimes;
  const crossed = new Set<CarId>();
  for (const m of list.slice(from)) {
    const progress = progressOf(m);
    if (progress < 0) continue; // laps count from 1
    const track = (acc.tracks[m.carId] ??= { fromProgress: 0, at: [] });
    track.at[progress] = m.at;
    track.at.length = progress + 1; // a car that went back drops what lay ahead
    crossed.add(m.carId);
    // segment 0 is the line at the start of its lap: it completes the lap before (none for lap 1, the start)
    const completed = m.lap - 1;
    if (m.segment === 0 && completed >= 1) {
      if (lineTimes === acc.lineTimes) lineTimes = { ...lineTimes };
      lineTimes[m.carId] = [...(lineTimes[m.carId] ?? []).filter((l) => l.lap < completed), { lap: completed, at: m.at }];
    }
  }
  const recent = { ...acc.recent };
  for (const id of crossed) recent[id] = recentOf(acc.tracks[id] as CarCrossings);
  acc.lineTimes = lineTimes;
  acc.recent = recent;
}

const RACE_PHASE = sessionPhaseRaceSpans.machine;

/**
 * The race start (C26): the start of the first `racing` span of the race session phase, known only if it directly follows
 * a `startLights` span (or opens the machine without `joinedAt`), i.e. the engine saw lights out (C3); a race joined later (under a safety car, say) has none. The
 * closed spans come first, then the open one; fixed once the first `racing` span is seen.
 */
function foldRaceStart(acc: Table, view: EngineView): void {
  if (acc.raceStart !== undefined) return;
  const spans = [...(view.history.spans[RACE_PHASE] ?? []), ...(view.situation.byMachine[RACE_PHASE] ?? [])];
  const at = spans.findIndex((s) => s.kind === 'racing');
  if (at < 0) return;
  acc.raceStart = (spans[at] as { start: SessionTime }).start;
  const before = spans[at - 1];
  // a `racing` span with nothing before it that was not joined opened with the machine: lights out was seen
  acc.lightsOutSeen = before === undefined ? spans[at]?.joinedAt !== true : before.kind === 'startLights';
}

/** The race-only parts apply: every row of the weekend phase and the session phases open now says so (C14, C44); none open yet: they do not. */
const raceOnly = (view: EngineView): boolean => {
  const rows = behaviourFor(GAPS_BEHAVIOUR, view).flatMap((row) => ('race' in row ? [row.race] : []));
  return rows.length > 0 && rows.every(Boolean);
};

const raceStartAt = (acc: Table, race: boolean): Known<SessionTime> => {
  if (!race) return NOT_APPLICABLE;
  return acc.raceStart === undefined || !acc.lightsOutSeen ? unknown('notReceived') : known(acc.raceStart, acc.raceStart);
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
  const standing = new Map<CarId, 'running' | 'out'>();
  for (const { id } of view.live.cars) {
    for (const row of behaviourFor(STATUS_BEHAVIOUR, view, id)) if ('car' in row && row.car !== 'absent') standing.set(id, row.car);
  }
  const running = view.live.cars
    .filter((c) => standing.get(c.id) === 'running') // out of the race: no gaps, no neighbour
    .sort((a, b) => a.timing.position - b.timing.position || a.id - b.id);
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
    raceStartAt: raceStartAt(acc, race),
    outOfRace: view.live.cars.filter((c) => standing.get(c.id) === 'out').map((c) => c.id).sort((a, b) => a - b),
    phases: phasesOf(acc, race, view),
  };
}

const init = (view: EngineView): GapsAcc => {
  const table: Table = { tracks: [], lineTimes: {}, recent: {}, raceStart: undefined, lightsOutSeen: false };
  foldCrossings(table, view, 0);
  foldRaceStart(table, view);
  return { ...table, out: build(table, view) };
};

/**
 * Every gap from the crossings, kept up to date crossing by crossing: each new crossing is one table write, and the
 * output is rebuilt from the table and the car state in O(cars), plus a binary search per car and phase. A flashback
 * starts over.
 */
export const gapsCalculator: IncrementalCalculator<GapsAcc, GapsOutput> = {
  id: GAPS,
  kind: 'incremental',
  reads: ['miniSectors', 'timing', 'identity', 'spans:weekend-phase', CAR_STATUS_READS, ...NEUTRALISATION_READS],
  cadence: 'frame',
  init,
  update(acc, delta, view) {
    if (delta.rewound !== undefined) return init(view);
    foldCrossings(acc, view, delta.before.crossings ?? 0);
    foldRaceStart(acc, view);
    acc.out = build(acc, view);
    return acc;
  },
  output: (acc) => acc.out,
};
