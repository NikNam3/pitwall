// The `incidents` calculator (spec 6.4): a fold over the events, flag phases, pit stops, laps and mini-sector crossings
// into `incidents.feed`. Positions and gaps before and after come from the crossings, so a flashback reproduces them.
import {
  addLaps,
  emptyCurrentLaps,
  known,
  unknown,
  type CarId,
  type CurrentLaps,
  type DamageJump,
  type IncidentEntry,
  type IncidentForUs,
  type IncidentKind,
  type Known,
  type LapRecord,
  type Ms,
  type SessionTime,
} from '@pitwall/domain';
import type { EngineView, IncrementalCalculator } from '@pitwall/engine';
import { DAMAGE, type DamageOutput } from '../damage/index.ts';
import { GAPS_CONFIG } from '../gaps/index.ts';
import { PACE_CONFIG } from '../pace/index.ts';
import { paceDeltaAround } from '../pace-delta/index.ts';
import { penaltyClass } from '../shared/penalties.ts';
import {
  addCrossing,
  emptyTrack,
  evaluate,
  gapIn,
  isNear,
  lapOfProgress,
  latestAt,
  positionIn,
  resetTrack,
  slowRuns,
  snapshotAt,
  type Snapshot,
  type Span,
  type SlowRun,
  type Track,
} from './incidents.ts';
import { INCIDENTS, INCIDENTS_CONFIG, type IncidentsOutput } from './index.ts';

/** "After" is this long after the incident. */
const AFTER_MS = 5_000;
/** A time loss this close to a collision or damage jump of the same car is part of that entry. */
const MERGE_MS = 5_000;

type Config = ReturnType<typeof INCIDENTS_CONFIG.read>;

const MAJOR = {
  collision: 'collisionMajor',
  retirement: 'retirementMajor',
  damage: 'damageMajor',
  timeLoss: 'timeLossMajor',
  warning: 'warningMajor',
  penalty: 'penaltyMajor',
  neutralised: 'neutralisedMajor',
} as const satisfies Record<IncidentKind, keyof Config>;

type CarEvent = { kind: 'collision' | 'retirement' | 'warning' | 'penalty'; at: SessionTime; carIds: CarId[] };

type Acc = {
  /** How much of each history list is folded. */
  events: number;
  miniSectors: number;
  flagPhases: number;
  pitStops: number;
  laps: number;
  /** Per car id. */
  tracks: (Track | undefined)[];
  /** Closed neutralised phases, and their starts for the feed. */
  phases: Span[];
  phaseStarts: { at: SessionTime; lap: number }[];
  /** Per car id, its recorded pit visits. */
  pits: Span[][];
  carEvents: CarEvent[];
  current: CurrentLaps;
  /** The newest crossing time; a moment up to it is final in the history. */
  newestAt: SessionTime;
  /** Positions at final moments. */
  snapshots: Map<SessionTime, Snapshot>;
  // From the latest view.
  active: { at: SessionTime; lap: number } | undefined;
  pitting: Set<CarId>;
  jumps: { carId: CarId; jump: DamageJump }[];
  ours: CarId[];
  isRace: boolean;
  config: Config;
  neighbourhoodMs: Ms;
  window: number;
};

const overlaps = (start: SessionTime, end: SessionTime, span: Span): boolean => start < span.end && end > span.start;

const readLive = (acc: Acc, view: EngineView): void => {
  const { state } = view;
  acc.isRace = state.session.kind === 'race';
  acc.config = INCIDENTS_CONFIG.read(view);
  acc.neighbourhoodMs = GAPS_CONFIG.read(view).neighbourhoodMs;
  acc.window = PACE_CONFIG.read(view).window;
  const { playerCar, teammateCar } = state;
  acc.ours = teammateCar === undefined || teammateCar === playerCar ? [playerCar] : [playerCar, teammateCar];
  const phase = view.activeFlagPhase;
  acc.active = phase && { at: phase.start, lap: phase.startLeaderLap };
  acc.pitting = new Set(state.cars.filter((c) => c.timing.pitStatus !== 'none').map((c) => c.id));
  const damage = view.outputs.get(DAMAGE) as DamageOutput | undefined;
  acc.jumps = damage === undefined ? [] : Object.entries(damage).flatMap(([id, d]) => d.jumps.map((jump) => ({ carId: Number(id) as CarId, jump })));
};

/** Folds the new spans and crossings; a new span re-evaluates the crossings it may cover (all cars for a flag phase). */
const foldCrossings = (acc: Acc, view: EngineView): void => {
  const { flagPhases, pitStops, miniSectors } = view.state.history;
  const reset = new Set<number>();
  let resetAll = false;
  for (const p of flagPhases.slice(acc.flagPhases)) {
    acc.phases.push({ start: p.start, end: p.end });
    acc.phaseStarts.push({ at: p.start, lap: p.startLeaderLap });
    resetAll = true;
  }
  acc.flagPhases = flagPhases.length;
  for (const s of pitStops.slice(acc.pitStops)) {
    (acc.pits[s.carId] ??= []).push({ start: s.pitLaneEntry, end: s.pitLaneExit });
    reset.add(s.carId);
  }
  acc.pitStops = pitStops.length;
  for (const c of miniSectors.slice(acc.miniSectors)) {
    if (c.lap < 1) continue;
    addCrossing((acc.tracks[c.carId] ??= emptyTrack()), c);
    if (c.at > acc.newestAt) acc.newestAt = c.at;
  }
  acc.miniSectors = miniSectors.length;

  const open: Span[] = acc.active === undefined ? [] : [{ start: acc.active.at, end: Infinity }];
  acc.tracks.forEach((track, id) => {
    if (track === undefined) return;
    if (resetAll || reset.has(id)) resetTrack(track);
    const spans = [...acc.phases, ...open, ...(acc.pits[id] ?? [])];
    evaluate(track, acc.config.timeLossMs, (start, end) => spans.some((s) => overlaps(start, end, s)));
  });
};

const foldEvents = (acc: Acc, view: EngineView): void => {
  const { events } = view.state.history;
  for (const e of events.slice(acc.events)) {
    if (e.carId === undefined) continue;
    const carIds = e.otherCarId === undefined ? [e.carId] : [e.carId, e.otherCarId];
    if (e.kind === 'collision' || e.kind === 'retirement') acc.carEvents.push({ kind: e.kind, at: e.at, carIds });
    else if (e.kind === 'penalty') {
      const kind = penaltyClass(e.params['penaltyType']);
      if (kind !== 'none') acc.carEvents.push({ kind, at: e.at, carIds: [e.carId] });
    }
  }
  acc.events = events.length;
};

const foldLaps = (acc: Acc, view: EngineView): void => {
  const { laps } = view.state.history;
  addLaps(acc.current, laps.slice(acc.laps) as LapRecord[]);
  acc.laps = laps.length;
};

const fold = (acc: Acc, view: EngineView): Acc => {
  readLive(acc, view);
  foldCrossings(acc, view);
  foldEvents(acc, view);
  foldLaps(acc, view);
  return acc;
};

const init = (view: EngineView): Acc =>
  fold(
    {
      events: 0,
      miniSectors: 0,
      flagPhases: 0,
      pitStops: 0,
      laps: 0,
      tracks: [],
      phases: [],
      phaseStarts: [],
      pits: [],
      carEvents: [],
      current: emptyCurrentLaps(),
      newestAt: -Infinity,
      snapshots: new Map(),
      active: undefined,
      pitting: new Set(),
      jumps: [],
      ours: [],
      isRace: false,
      config: INCIDENTS_CONFIG.read(view),
      neighbourhoodMs: 0,
      window: 0,
    },
    view,
  );

/** A feed entry before its neighbourhood, forUs and pace are resolved. */
type Candidate = {
  id: string;
  kind: IncidentKind;
  at: SessionTime;
  carIds: CarId[];
  /** Known up front for damage and neutralised entries; otherwise from the primary car's crossings. */
  lap?: number;
  jump?: DamageJump;
  run?: SlowRun;
  merged: SlowRun[];
};

const candidate = (kind: IncidentKind, at: SessionTime, carIds: CarId[], extra: Partial<Candidate> = {}): Candidate => ({
  id: `${kind}:${carIds.join('-')}:${at}`,
  kind,
  at,
  carIds,
  merged: [],
  ...extra,
});

const snapshot = (acc: Acc, t: SessionTime): Snapshot => {
  if (t > acc.newestAt) return snapshotAt(acc.tracks, t);
  let snap = acc.snapshots.get(t);
  if (snap === undefined) acc.snapshots.set(t, (snap = snapshotAt(acc.tracks, t)));
  return snap;
};

/** The time loss runs that stand, minus those still running into a pit lane the car is in now. */
const standingRuns = (acc: Acc): SlowRun[] =>
  acc.tracks.flatMap((track, id) => {
    if (track === undefined) return [];
    const runs = slowRuns(id as CarId, track);
    const newest = track.points[track.points.length - 1]?.progress;
    return acc.pitting.has(id as CarId) ? runs.filter((r) => r.endProgress !== newest) : runs;
  });

/** Every entry the history gives, with each time loss merged into a collision or damage entry of its car close by. */
const candidates = (acc: Acc): Candidate[] => {
  const list = acc.carEvents.map((e) => candidate(e.kind, e.at, e.carIds));
  for (const { carId, jump } of acc.jumps) list.push(candidate('damage', jump.at, [carId], { lap: jump.lap, jump }));
  const absorbers = list.filter((c) => c.kind === 'collision' || c.kind === 'damage');
  for (const run of standingRuns(acc)) {
    // F1 25 names a collision's two cars in no fixed order, so either one's time loss belongs to it.
    const into = absorbers.filter((c) => c.carIds.includes(run.carId) && Math.abs(c.at - run.at) <= MERGE_MS);
    for (const c of into) c.merged.push(run);
    if (into.length === 0) list.push(candidate('timeLoss', run.at, [run.carId], { lap: lapOfProgress(run.startProgress), run }));
  }
  const starts = acc.active === undefined ? acc.phaseStarts : [...acc.phaseStarts, acc.active];
  for (const { at, lap } of starts) list.push(candidate('neutralised', at, [], { lap }));
  return list;
};

const runsLoss = (runs: SlowRun[]): Known<Ms> =>
  known(
    runs.reduce((sum, r) => sum + r.lossMs, 0),
    Math.max(...runs.map((r) => r.endAt)),
  );

/** The loss of the car's mini-sector that holds `t`, against its median. */
const segmentLoss = (acc: Acc, id: CarId, t: SessionTime): Known<Ms> => {
  const track = acc.tracks[id];
  const point = track && latestAt(track, t);
  const loss = point && track?.loss[point.progress];
  if (loss === undefined) return unknown('notReceived');
  if (loss === 'excluded') return unknown('notApplicable');
  if (loss === 'fewLaps') return unknown('insufficientData');
  return known(loss.lossMs, loss.end);
};

/** `pace-delta` over the car's pace laps around `lap` (the lap itself excluded). */
const paceAround = (acc: Acc, id: CarId, lap: number): Known<Ms> => paceDeltaAround(Object.values(acc.current[id] ?? {}), lap, acc);

/** Kinds with no time lost: the car is out, the field is neutralised, or the entry is a ruling, not a loss. */
const NO_TIME_LOST: ReadonlySet<IncidentKind> = new Set(['retirement', 'neutralised', 'warning', 'penalty']);

/**
 * From the mini-sector at once, then from `pace-delta` once there are laps (spec 6.4). The loss is of the car that
 * lost time: the first car, unless only the other car of a collision has a merged time loss.
 */
const timeLost = (acc: Acc, c: Candidate, lap: number): Known<Ms> => {
  const first = c.carIds[0];
  if (first === undefined || NO_TIME_LOST.has(c.kind)) return unknown('notApplicable');
  if (c.jump?.lossMsPerLap.known) return c.jump.lossMsPerLap;
  const car = c.merged.length > 0 && !c.merged.some((r) => r.carId === first) ? (c.merged[0]?.carId ?? first) : first;
  if (c.kind !== 'damage') {
    const pace = paceAround(acc, car, lap);
    if (pace.known) return pace;
  }
  if (c.run !== undefined) return runsLoss([c.run]);
  const merged = c.merged.filter((r) => r.carId === car);
  if (merged.length > 0) return runsLoss(merged);
  return segmentLoss(acc, car, c.at);
};

const gapKnown = (acc: Acc, snap: Snapshot, ours: CarId, other: CarId, at: SessionTime): Known<Ms> => {
  const gap = gapIn(acc.tracks, snap, ours, other);
  return gap === undefined ? unknown('notReceived') : known(gap, at);
};

/** Per our car that is involved or has an involved car in its neighbourhood: its position and gap before and after. */
const forUsOf = (acc: Acc, c: Candidate): IncidentForUs[] => {
  const before = snapshot(acc, c.at);
  const afterAt = c.at + AFTER_MS;
  const after = acc.newestAt >= afterAt ? snapshot(acc, afterAt) : undefined;
  const items: IncidentForUs[] = [];
  for (const ours of acc.ours) {
    const concerned =
      c.kind === 'neutralised' ||
      c.carIds.some((id) => id === ours || isNear(acc.tracks, before, ours, id, acc.neighbourhoodMs));
    if (!concerned) continue;
    const other = c.carIds.find((id) => id !== ours);
    items.push({
      ourCarId: ours,
      positionBefore: positionIn(before, ours),
      positionAfter: after === undefined ? unknown('notReceived') : known(positionIn(after, ours), afterAt),
      gapBeforeMs: other === undefined ? unknown('notApplicable') : gapKnown(acc, before, ours, other, c.at),
      gapAfterMs:
        other === undefined ? unknown('notApplicable') : after === undefined ? unknown('notReceived') : gapKnown(acc, after, ours, other, afterAt),
    });
  }
  return items;
};

const lapOf = (acc: Acc, c: Candidate): number => {
  if (c.lap !== undefined) return c.lap;
  const primary = c.carIds[0];
  const point = primary === undefined ? undefined : snapshot(acc, c.at).latest[primary];
  return point === undefined ? 1 : lapOfProgress(point.progress);
};

/** Newest first, ties by id; only entries of our cars or their neighbourhood, cut at `feedLength`. */
const output = (acc: Acc): IncidentsOutput => {
  if (!acc.isRace) return [];
  const byId = new Map<string, Candidate>();
  for (const c of candidates(acc)) if (!byId.has(c.id)) byId.set(c.id, c);
  const sorted = [...byId.values()].sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const feed: IncidentEntry[] = [];
  for (const c of sorted) {
    if (feed.length >= acc.config.feedLength) break;
    const forUs = forUsOf(acc, c);
    if (forUs.length === 0) continue;
    const lap = lapOf(acc, c);
    feed.push({
      id: c.id,
      at: c.at,
      lap,
      kind: c.kind,
      severity: acc.config[MAJOR[c.kind]] ? 'major' : 'minor',
      carIds: [...c.carIds],
      timeLostMs: timeLost(acc, c, lap),
      forUs,
    });
  }
  return feed;
};

/** The incidents feed of the race: an incremental fold; a flashback starts it over. */
export const incidentsCalculator: IncrementalCalculator<Acc, IncidentsOutput> = {
  id: INCIDENTS,
  kind: 'incremental',
  reads: ['session', 'identity', 'timing', 'events', 'flagPhases', 'miniSectors', 'pitStops', 'laps', { calculator: DAMAGE }],
  cadence: { hz: 4 },
  init,
  update: (acc, delta, view) => (delta.truncated ? init(view) : fold(acc, view)),
  output,
};
