// The `gaps` calculator (spec 6.1): a fold over the mini-sector crossings; the order and our cars come from the car state.
import { known, MINI_SECTORS, unknown, type CarId, type Interval, type Known, type Ms, type Neighbourhood, type SessionTime } from '@pitwall/domain';
import type { EngineView, IncrementalCalculator } from '@pitwall/engine/readers';
import { isClosed, NEUTRALISATION_READS, neutralisationKind, neutralisedSpans, type NeutralisationKind } from '../shared/neutralised.ts';
import { ourCars } from '../shared/our-cars.ts';
import { outOfRace } from '../shared/out-of-race.ts';
import { gapBehind, lapsBehind, latestTime, progressAt, progressOf, recentOf, type CarCrossings } from './gaps.ts';
import { GAPS, GAPS_CONFIG, type GapsOutput } from './index.ts';

/** What the crossings and events so far add up to. */
type Table = {
  /** By car id: every crossing, from progress 0. */
  tracks: Array<CarCrossings | undefined>;
  lineTimes: GapsOutput['lineTimes'];
  recent: GapsOutput['recent'];
  /** The newest lights-out event. */
  lightsOutAt: SessionTime | undefined;
};

type GapsAcc = Table & { out: GapsOutput };

const NOT_APPLICABLE = unknown('notApplicable');

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

function foldEvents(acc: Table, view: EngineView, from: number): void {
  for (const e of view.history.events.slice(from)) if (e.kind === 'lightsOut') acc.lightsOutAt = e.at;
}

const raceStartAt = (acc: Table, view: EngineView): Known<SessionTime> => {
  if (view.live.session.kind !== 'race') return NOT_APPLICABLE;
  return acc.lightsOutAt === undefined ? unknown('notReceived') : known(acc.lightsOutAt, acc.lightsOutAt);
};

/** The gap of `a` to the car ahead of it in the order: the time since that car passed where `a` is now. */
const roadGap = (a: CarCrossings | undefined, ahead: CarCrossings | undefined): Known<Ms> =>
  gapBehind(a, ahead, a === undefined || ahead === undefined ? 0 : lapsBehind(a, ahead));

const leaderGap = (leader: CarCrossings | undefined): Known<Ms> => {
  const at = leader === undefined ? undefined : latestTime(leader);
  return at === undefined ? unknown('notReceived') : known(0, at);
};

/** Grid position minus position; the grid position is 0 until the first LapData (the engine counts it from 1). */
const positionsGained = (timing: { gridPosition: number; position: number }, view: EngineView): Known<number> => {
  if (view.live.session.kind !== 'race') return NOT_APPLICABLE;
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
const phasesOf = (acc: Table, view: EngineView): GapsOutput['phases'] => {
  if (view.live.session.kind !== 'race') return [];
  return neutralisedPhases(view).map(({ kind, start, end }) => ({
    kind,
    fromLap: leaderLapAt(acc, start),
    toLap: end === undefined ? NOT_APPLICABLE : known(leaderLapAt(acc, end), end),
  }));
};

/** The running cars in position order (ties by id), their intervals, the cars around each of ours, and the cars out of the race. */
function build(acc: Table, view: EngineView): GapsOutput {
  const active = view.live.cars.filter((c) => c.active);
  const running = active
    .filter((c) => !outOfRace(c)) // out of the race: no gaps, no neighbour
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
      positionsGained: positionsGained(timing, view),
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
    raceStartAt: raceStartAt(acc, view),
    outOfRace: active.filter((c) => outOfRace(c)).map((c) => c.id).sort((a, b) => a - b),
    phases: phasesOf(acc, view),
  };
}

const init = (view: EngineView): GapsAcc => {
  const table: Table = { tracks: [], lineTimes: {}, recent: {}, lightsOutAt: undefined };
  foldCrossings(table, view, 0);
  foldEvents(table, view, 0);
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
  reads: ['miniSectors', 'timing', 'identity', 'events', ...NEUTRALISATION_READS],
  cadence: 'frame',
  init,
  update(acc, delta, view) {
    if (delta.rewound !== undefined) return init(view);
    foldCrossings(acc, view, delta.before.crossings ?? 0);
    foldEvents(acc, view, delta.before.events ?? 0);
    acc.out = build(acc, view);
    return acc;
  },
  output: (acc) => acc.out,
};
