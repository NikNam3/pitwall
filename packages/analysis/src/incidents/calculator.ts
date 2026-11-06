// The `incidents` calculator (spec 6.4): a fold over the events, the spans of the sub-machines it reads (C20), laps and
// mini-sector crossings into `incidents.feed`, by its behaviour table (`behaviour.ts`, C44): the race from the weekend
// phase (C14), the neutralisations from the session-phase spans (through `shared/neutralised.ts`), pit visits from
// car-location, retirements and disqualifications from car-status, warnings from their spans, penalties given from the
// projection's penalty records, one entry per record (C25, C45). A span is matched to a mini-sector by frames (C26). Positions and gaps before and after, and the sector, come from the
// crossings, so a flashback reproduces them. A log: it reads the history only, never another analysis's output (C45);
// its damage entries come from the shared jump grouping over the `damageChange` events (`shared/damage-jumps.ts`) and
// stay through a repair. The accumulator folds the projection's lists and closed spans and the config alone (C31.2);
// `output` adds the open spans, the live state (our cars, the track layout) and the track file (where, the markers).
import {
  addLaps,
  emptyCurrentLaps,
  known,
  unknown,
  type CarId,
  type CurrentLaps,
  type FrameNumber,
  type IncidentCause,
  type IncidentDamagePart,
  type IncidentEntry,
  type IncidentForUs,
  type IncidentKind,
  type IncidentPenalty,
  type IncidentWhere,
  type Known,
  type LapFraction,
  type LapRecord,
  type MachineId,
  type MapIncident,
  type MiniSectorCrossing,
  type Ms,
  type OpenSpan,
  type PenaltyRecord,
  type RaceEvent,
  type SessionTime,
  type Span,
  type TrackTurn,
  type WarnedDetail,
} from '@pitwall/domain';
import { openSpansOf, type ChangeTag, type DeepReadonly, type EngineView, type IncrementalCalculator } from '@pitwall/engine/readers';
import { ALARMS_CONFIG } from '../alarms/index.ts';
import { DAMAGE_CONFIG } from '../damage/index.ts';
import { GAPS_CONFIG } from '../gaps/index.ts';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PACE_CONFIG } from '../pace/index.ts';
import { paceDeltaAround } from '../pace-delta/index.ts';
import { emptyDamageJumps, finishJump, foldDamageJumps, type DamageJumpFold, type FinishedJump } from '../shared/damage-jumps.ts';
import { isNeutralisation, leaderLapAt, NEUTRALISATION_MACHINES, NEUTRALISATION_READS, neutralisationKind, type NeutralisationKind } from '../shared/neutralised.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { ourCars } from '../shared/our-cars.ts';
import { warningInCycle } from '../shared/penalties.ts';
import { pointAt, turnAt } from '../shared/track-lookup.ts';
import { behaviourOf, INCIDENTS_BEHAVIOUR } from './behaviour.ts';
import {
  addCrossing,
  emptyTrack,
  evaluate,
  fractionAt,
  gapIn,
  isNear,
  lapOfProgress,
  latestAt,
  positionIn,
  resetTrack,
  sectorAt,
  slowRuns,
  snapshotAt,
  type Point,
  type Snapshot,
  type SlowRun,
  type Track,
  type TrackLayout,
} from './incidents.ts';
import { INCIDENTS, INCIDENTS_CONFIG, type IncidentsOutput } from './index.ts';

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

/**
 * `cornerCutting`: on a corner-cutting warning, the warned span's count of the car's corner-cutting warnings (a warning of
 * another kind has none); `penalty`: on a penalty, its ruling; `id`: the entry's own id where kind, cars and time do not
 * tell it apart (a penalty record's).
 */
type CarEvent = {
  id?: string;
  kind: 'collision' | 'retirement' | 'warning' | 'penalty';
  at: SessionTime;
  /** The frame the entry describes (C26): its span's start, its event's or its record's. */
  frame: FrameNumber;
  carIds: CarId[];
  cornerCutting?: number;
  /** On a warning of another kind, the warned span's infringement code. */
  infringement?: Known<number>;
  penalty?: IncidentPenalty;
};

/**
 * A neutralisation (`shared/neutralised.ts`): its start, the leader's lap at its start frame (ruling 3, from the
 * projection's laps) and the frames it covers, `startFrame <= f < endFrame` (C26; an open one ends at `Infinity`).
 */
type Neutralised = { at: SessionTime; lap: number; startFrame: FrameNumber; endFrame: FrameNumber; neutralisation: NeutralisationKind };

/** The car-scoped sub-machines whose spans `incidents` folds (C20). */
const CAR_MACHINES = ['car-location', 'car-status', 'warnings'] as const satisfies readonly MachineId[];
type CarMachine = (typeof CAR_MACHINES)[number];

/** The weekend phase's rows alone: whether the feed holds anything (C14). */
const WEEKEND_PHASE = { 'weekend-phase': INCIDENTS_BEHAVIOUR['weekend-phase'] };

/** A car's span of row `noTimeLoss` (a pit visit, a garage spell): the frames it covers, `startFrame <= f < endFrame` (C26). */
type Visit = { startFrame: FrameNumber; endFrame: FrameNumber };

type CarSpan = DeepReadonly<Span> | DeepReadonly<OpenSpan>;

/** A closed neutralisation: its start and the frames it covers, `startFrame <= f < endFrame` (C26). */
type ClosedNeutralised = Omit<Neutralised, 'lap'>;

/**
 * The accumulator: a pure fold over the projection's events, crossings, laps and closed spans, and the config (C31.2).
 * The open spans and the live state are read by `output` (`Now`), never kept here.
 */
type Acc = {
  /** How much of each history list is folded. */
  events: number;
  crossings: number;
  laps: number;
  penalties: number;
  /** How many closed spans of each car sub-machine are folded. */
  closed: Record<CarMachine, number>;
  /** How many closed spans of each session-phase sub-machine are folded. */
  closedPhases: Record<MachineId, number>;
  /**
   * Per car id; each mini-sector evaluated against the closed neutralisations and visits. One that an open span covers
   * too is `excluded` only in `output`, which knows the open spans (`cutOf`).
   */
  tracks: (Track | undefined)[];
  /** The closed neutralisations by session-phase sub-machine, in their order. */
  neutralised: Record<MachineId, ClosedNeutralised[]>;
  /** Every lap folded so far: its number and the frame it describes, for the leader's lap at a frame (C26). */
  lapFrames: Pick<LapRecord, 'lapNumber' | 'frame'>[];
  /** Per car id, its closed pit visits and garage spells, by frame. */
  visits: Visit[][];
  /** The entries of the closed spans, by car sub-machine. */
  spanEvents: Record<CarMachine, CarEvent[]>;
  /** Per car id, the corner-cutting count of its newest closed warnings span (0 for no warning): what the next one rises from. */
  cornerCuttingOf: (number | undefined)[];
  /** The collisions (events). */
  collisions: CarEvent[];
  /** The penalties given (the penalty records), one per record. */
  given: CarEvent[];
  /** How many records of each car, kind and time are folded: the ordinal in a record entry's id. */
  givenCount: Map<string, number>;
  /** Per car id, the frame its first closed retired span opened on. */
  retiredFrom: (FrameNumber | undefined)[];
  current: CurrentLaps;
  /** The shared jump grouping over the events folded so far: every jump, repaired or not. */
  grouping: DamageJumpFold;
  /** The newest crossing time; a moment up to it is final in the history. */
  newestAt: SessionTime;
  config: Config;
  neighbourhoodMs: Ms;
  window: number;
  /** Neutralised time a pace lap stays below (the `lap-classes` config). */
  maxNeutralisedMs: number;
  /** Rises of a part that add up to this are a jump (the damage config). */
  jumpPct: number;
  /** Rises of a part within this window add up; damage jumps of a car this close to the first one are one entry. */
  jumpWindowMs: Ms;
  /** Corner-cutting warnings before a penalty (the alarms' config). */
  warningLimit: number;
};

/** What `output` reads from the view (the live state and the open spans, C20) beside the fold. */
type Now = {
  /** The weekend phase's row is `feed` (C14): the race, where lap 1 is no pace lap (`lap-classes`). */
  isRace: true;
  ours: CarId[];
  layout: TrackLayout;
  /** The neutralisations, closed then open, with the leader's lap at each start. */
  neutralisedNow: Neutralised[];
  /** The start frame of the open neutralisation, if one is open. */
  openNeutralisedFrom: FrameNumber | undefined;
  /** Per car id, the start frame of its open pit visit or garage spell. */
  openVisits: (FrameNumber | undefined)[];
  /** Per car id, the frame its open retired span opened on. */
  openRetiredFrom: (FrameNumber | undefined)[];
  /** The entries of the open spans. */
  openEvents: CarEvent[];
  /** Positions at final moments, for this output only. */
  snapshots: Map<SessionTime, Snapshot>;
};

/** The fold and the view's now, as `output` combines them. */
type Board = Acc & Now;

/** The mini-sector from crossing `from` to crossing `to` covers frames `from.frame <= f < to.frame`: it shares one with `span` (C26). */
const sharesFrame = (from: Point, to: Point, span: { startFrame: FrameNumber; endFrame: FrameNumber }): boolean =>
  from.frame < span.endFrame && to.frame > span.startFrame;

/** The config sections the feed reads (C47), fixed for the run. */
const settings = (view: EngineView) => {
  const { jumpPct, jumpWindowMs } = DAMAGE_CONFIG.read(view);
  return {
    config: INCIDENTS_CONFIG.read(view),
    jumpPct,
    jumpWindowMs,
    warningLimit: ALARMS_CONFIG.read(view).warningsBeforePenalty,
    neighbourhoodMs: GAPS_CONFIG.read(view).neighbourhoodMs,
    window: PACE_CONFIG.read(view).window,
    maxNeutralisedMs: LAP_CLASSES_CONFIG.read(view).maxNeutralisedMs,
  };
};

/** Folds the new closed neutralisations (`shared/neutralised.ts`); whether there were any, so the tracks are evaluated again. */
const foldNeutralised = (acc: Acc, view: EngineView): boolean => {
  let changed = false;
  for (const machine of NEUTRALISATION_MACHINES) {
    const list = view.history.spans[machine] ?? [];
    for (let i = acc.closedPhases[machine] ?? 0; i < list.length; i++) {
      const span = list[i] as DeepReadonly<Span>;
      if (!isNeutralisation(machine, span) || behaviourOf(machine, span.kind) !== 'neutralised') continue;
      (acc.neutralised[machine] ??= []).push({ at: span.start, startFrame: span.startFrame, endFrame: span.endFrame, neutralisation: neutralisationKind(span) });
      changed = true;
    }
    acc.closedPhases[machine] = list.length;
  }
  return changed;
};

/** The corner-cutting count a car's warnings span records: a warned span's (its row `warning`), else 0. */
const cornerCuttingOf = (machine: CarMachine, span: CarSpan): number =>
  behaviourOf(machine, span.kind) === 'warning' ? (span.detail as WarnedDetail).cornerCutting : 0;

/**
 * The entries a car's span gives by its row (C44), at its start: none for a span the engine joined in (its incident was
 * not seen) or one closed unconfirmed (C18). A warning is a corner-cutting one when its span's corner-cutting count rose
 * over `cornerCuttingBefore`, the car's previous warnings span's; only then does it carry that count.
 */
const entriesOf = (machine: CarMachine, span: CarSpan, cornerCuttingBefore: number): CarEvent[] => {
  if (span.carId === undefined || span.joinedAt === true || ('endFrame' in span && !span.confirmed)) return [];
  const base = { at: span.start, frame: span.startFrame, carIds: [span.carId] };
  switch (behaviourOf(machine, span.kind)) {
    case 'retirement':
      return [{ kind: 'retirement', ...base }];
    case 'disqualification':
      return [{ kind: 'penalty', ...base, penalty: { kind: 'disqualified' } }];
    case 'warning': {
      const cornerCutting = cornerCuttingOf(machine, span);
      if (cornerCutting > cornerCuttingBefore) return [{ kind: 'warning', ...base, cornerCutting }];
      return [{ kind: 'warning', ...base, infringement: (span.detail as WarnedDetail).infringement }];
    }
    default:
      return [];
  }
};

/**
 * Folds the closed spans of the car sub-machines new in the projection, in their order. Returns the cars whose closed
 * pit visits or garage spells changed.
 */
const foldCarSpans = (acc: Acc, view: EngineView): Set<CarId> => {
  const changed = new Set<CarId>();
  for (const machine of CAR_MACHINES) {
    const list = view.history.spans[machine] ?? [];
    for (let i = acc.closed[machine]; i < list.length; i++) {
      const span = list[i] as DeepReadonly<Span>;
      const id = span.carId;
      if (id === undefined) continue;
      const row = behaviourOf(machine, span.kind);
      if (row === 'noTimeLoss') {
        (acc.visits[id] ??= []).push({ startFrame: span.startFrame, endFrame: span.endFrame });
        changed.add(id);
      }
      if (row === 'retirement' && span.confirmed) acc.retiredFrom[id] ??= span.startFrame;
      acc.spanEvents[machine].push(...entriesOf(machine, span, acc.cornerCuttingOf[id] ?? 0));
      if (machine === 'warnings') acc.cornerCuttingOf[id] = cornerCuttingOf(machine, span);
    }
    acc.closed[machine] = list.length;
  }
  return changed;
};

/**
 * Folds the new crossings; a new closed pit visit or garage spell of a car (`visitsChanged`) re-evaluates its crossings,
 * and a new closed neutralisation (`neutralisedChanged`) every car's, so the fold equals a run from scratch (C31). A
 * mini-sector is no time loss when it shares a frame with a closed neutralisation or one of its car's closed visits
 * (C26); the open ones are applied by `output`.
 */
const foldCrossings = (acc: Acc, view: EngineView, neutralisedChanged: boolean, visitsChanged: ReadonlySet<CarId>): void => {
  const { crossings } = view.history;
  for (let i = acc.crossings; i < crossings.length; i++) {
    const c = crossings[i] as MiniSectorCrossing;
    if (c.lap < 1) continue;
    addCrossing((acc.tracks[c.carId] ??= emptyTrack()), c);
    if (c.at > acc.newestAt) acc.newestAt = c.at;
  }
  acc.crossings = crossings.length;

  const neutralised = NEUTRALISATION_MACHINES.flatMap((machine) => acc.neutralised[machine] ?? []);
  acc.tracks.forEach((track, id) => {
    if (track === undefined) return;
    if (neutralisedChanged || visitsChanged.has(id as CarId)) resetTrack(track);
    const visits = acc.visits[id] ?? [];
    evaluate(
      track,
      acc.config.timeLossMs,
      (from, to) => neutralised.some((n) => sharesFrame(from, to, n)) || visits.some((v) => sharesFrame(from, to, v)),
    );
  });
};

/** Folds the new collisions and damage changes; retirements and warnings come from the spans (C13, C20), penalties from their records. */
const foldEvents = (acc: Acc, view: EngineView): void => {
  const { events } = view.history;
  for (let i = acc.events; i < events.length; i++) {
    const e = events[i] as DeepReadonly<RaceEvent>;
    if (e.carId === undefined || e.kind !== 'collision') continue;
    const carIds = e.otherCarId === undefined ? [e.carId] : [e.carId, e.otherCarId];
    acc.collisions.push({ kind: 'collision', at: e.at, frame: e.frame, carIds });
  }
  acc.events = events.length;
  foldDamageJumps(acc.grouping, events, acc);
};

/** The ruling of a penalty record: its kind, its time for a time penalty, and its infringement (unknown stays unknown, C3). */
const penaltyOf = (record: DeepReadonly<PenaltyRecord>): IncidentPenalty => ({
  kind: record.kind,
  ...(record.timeMs !== undefined && { timeMs: record.timeMs }),
  infringement: record.infringement as Known<number>,
});

/**
 * Folds the new penalty records, one penalty entry each (C25, C45). Its id is the car, kind and time with the record's
 * ordinal among the folded records of the same car, kind and time, so two records given at once are two entries.
 */
const foldPenalties = (acc: Acc, view: EngineView): void => {
  const { penalties } = view.history;
  for (let i = acc.penalties; i < penalties.length; i++) {
    const record = penalties[i] as DeepReadonly<PenaltyRecord>;
    const key = `${record.kind}:${record.carId}:${record.at}`;
    const n = acc.givenCount.get(key) ?? 0;
    acc.givenCount.set(key, n + 1);
    acc.given.push({ id: `penalty:${key}:${n}`, kind: 'penalty', at: record.at, frame: record.frame, carIds: [record.carId], penalty: penaltyOf(record) });
  }
  acc.penalties = penalties.length;
};

const foldLaps = (acc: Acc, view: EngineView): void => {
  const { laps } = view.history;
  const fresh = laps.slice(acc.laps) as LapRecord[];
  addLaps(acc.current, fresh);
  for (const { lapNumber, frame } of fresh) acc.lapFrames.push({ lapNumber, frame });
  acc.laps = laps.length;
};

const fold = (acc: Acc, view: EngineView): Acc => {
  const neutralisedChanged = foldNeutralised(acc, view);
  foldCrossings(acc, view, neutralisedChanged, foldCarSpans(acc, view));
  foldEvents(acc, view);
  foldPenalties(acc, view);
  foldLaps(acc, view);
  return acc;
};

const init = (view: EngineView): Acc =>
  fold(
    {
      events: 0,
      crossings: 0,
      laps: 0,
      penalties: 0,
      closed: { 'car-location': 0, 'car-status': 0, warnings: 0 },
      closedPhases: Object.fromEntries(NEUTRALISATION_MACHINES.map((machine) => [machine, 0])),
      tracks: [],
      neutralised: Object.fromEntries(NEUTRALISATION_MACHINES.map((machine) => [machine, []])),
      lapFrames: [],
      visits: [],
      spanEvents: { 'car-location': [], 'car-status': [], warnings: [] },
      cornerCuttingOf: [],
      collisions: [],
      given: [],
      givenCount: new Map(),
      retiredFrom: [],
      current: emptyCurrentLaps(),
      grouping: emptyDamageJumps(),
      newestAt: -Infinity,
      ...settings(view),
    },
    view,
  );

/**
 * What the view adds to the fold in the race (its weekend phase's row is `feed`): our cars and the track layout (the live state), the open spans of the car
 * sub-machines and the open neutralisation (C20), and every neutralisation's leader lap from the folded laps (C26).
 */
const nowOf = (acc: Acc, view: EngineView): Now => {
  const { live } = view;
  const openVisits: (FrameNumber | undefined)[] = [];
  const openRetiredFrom: (FrameNumber | undefined)[] = [];
  const openEvents: CarEvent[] = [];
  for (const machine of CAR_MACHINES) {
    for (const span of openSpansOf(view, machine)) {
      const id = span.carId;
      if (id === undefined) continue;
      const row = behaviourOf(machine, span.kind);
      if (row === 'noTimeLoss') openVisits[id] = span.startFrame;
      if (row === 'retirement') openRetiredFrom[id] = span.startFrame;
      openEvents.push(...entriesOf(machine, span, acc.cornerCuttingOf[id] ?? 0));
    }
  }
  const open = NEUTRALISATION_MACHINES.flatMap((machine) =>
    openSpansOf(view, machine).filter((span) => isNeutralisation(machine, span) && behaviourOf(machine, span.kind) === 'neutralised'),
  );
  const closed = NEUTRALISATION_MACHINES.flatMap((machine) => acc.neutralised[machine] ?? []);
  const spans = [...closed, ...open.map((span) => ({ at: span.start, startFrame: span.startFrame, endFrame: Infinity, neutralisation: neutralisationKind(span) }))];
  const { trackLengthM, sector2StartM, sector3StartM } = live.session;
  return {
    isRace: true,
    ours: ourCars(live),
    layout: { trackLengthM, sector2StartM, sector3StartM },
    neutralisedNow: spans.map((n) => ({ ...n, lap: leaderLapAt(acc.lapFrames, n.startFrame) })),
    openNeutralisedFrom: open.reduce<FrameNumber | undefined>((min, span) => (min === undefined || span.startFrame < min ? span.startFrame : min), undefined),
    openVisits,
    openRetiredFrom,
    openEvents,
    snapshots: new Map(),
  };
};

/**
 * The frame after which the open spans exclude the car's mini-sectors: an open neutralisation or pit visit covers every
 * frame from its start on, so a mini-sector ending after it shares a frame with it (C26); `Infinity` with none open.
 */
const cutOf = (b: Board, id: CarId): FrameNumber => Math.min(b.openNeutralisedFrom ?? Infinity, b.openVisits[id] ?? Infinity);

/** A feed entry before its neighbourhood, forUs and pace are resolved. */
type Candidate = {
  id: string;
  kind: IncidentKind;
  at: SessionTime;
  /** The frame the entry describes (C26), for the leader's lap at it. */
  frame: FrameNumber;
  carIds: CarId[];
  /** Known up front for damage and neutralised entries; otherwise from the primary car's crossings. */
  lap?: number;
  /** The first damage jump of a damage entry, and every jump of it. */
  jump?: FinishedJump;
  jumps?: FinishedJump[];
  /** A corner-cutting warning entry's count of the car's corner-cutting warnings. */
  cornerCutting?: number;
  /** A warning entry of another kind: the warned span's infringement code. */
  infringement?: Known<number>;
  /** A neutralised entry's kind (`neutralisationKind`). */
  neutralisation?: NeutralisationKind;
  /** A penalty entry's ruling. */
  penalty?: IncidentPenalty;
  run?: SlowRun;
  merged: SlowRun[];
};

const candidate = (kind: IncidentKind, at: SessionTime, frame: FrameNumber, carIds: CarId[], extra: Partial<Candidate> = {}): Candidate => ({
  id: `${kind}:${carIds.join('-')}:${at}`,
  kind,
  at,
  frame,
  carIds,
  merged: [],
  ...extra,
});

const snapshot = (acc: Board, t: SessionTime): Snapshot => {
  if (t > acc.newestAt) return snapshotAt(acc.tracks, t);
  let snap = acc.snapshots.get(t);
  if (snap === undefined) acc.snapshots.set(t, (snap = snapshotAt(acc.tracks, t)));
  return snap;
};

/** The car's lap at `t` from its crossings; lap 1 before its first one. */
const crossingLap = (acc: Board, id: CarId, t: SessionTime): number => {
  const point = snapshot(acc, t).latest[id];
  return point === undefined ? 1 : lapOfProgress(point.progress);
};

/**
 * The time loss runs that stand: of the slow mini-sectors no open span covers (`cutOf`), minus those still running into
 * a pit visit or garage spell the car is in now (its open span).
 */
const standingRuns = (acc: Board): SlowRun[] =>
  acc.tracks.flatMap((track, id) => {
    if (track === undefined) return [];
    const cut = cutOf(acc, id as CarId);
    const runs = slowRuns(id as CarId, cut === Infinity ? track.slow : track.slow.filter((s) => s.endFrame <= cut));
    const newest = track.points[track.points.length - 1]?.progress;
    return acc.openVisits[id] !== undefined ? runs.filter((r) => r.endProgress !== newest) : runs;
  });

/**
 * Every damage jump of every car, repaired or not, with its lap and loss (the lap from the crossings without a lap
 * record) and the frame it describes (C26).
 */
const allJumps = (acc: Board): { carId: CarId; jump: FinishedJump; frame: FrameNumber }[] =>
  [...acc.grouping.jumps].flatMap(([carId, raws]) => {
    // integer keys iterate in ascending order: the car's laps by lap number
    const laps = Object.values(acc.current[carId] ?? {});
    const frames = acc.grouping.frames.get(carId) ?? [];
    return raws.map((raw, i) => ({ carId, jump: finishJump(raw, laps, crossingLap(acc, carId, raw.at), acc), frame: frames[i] as FrameNumber }));
  });

/** One damage entry's jumps; `frame`: the frame its first jump describes. */
type DamageGroup = { carId: CarId; frame: FrameNumber; jumps: FinishedJump[] };

/** Each car's damage jumps grouped: a jump within `jumpWindowMs` of a group's first one joins it (one incident, several parts). */
const damageGroups = (acc: Board): DamageGroup[] => {
  const groups: DamageGroup[] = [];
  const open = new Map<CarId, DamageGroup>();
  const sorted = allJumps(acc).sort((a, b) => a.jump.at - b.jump.at || a.carId - b.carId);
  for (const { carId, jump, frame } of sorted) {
    const group = open.get(carId);
    const first = group?.jumps[0];
    if (group !== undefined && first !== undefined && jump.at - first.at <= acc.jumpWindowMs) {
      group.jumps.push(jump);
      continue;
    }
    const fresh = { carId, frame, jumps: [jump] };
    open.set(carId, fresh);
    groups.push(fresh);
  }
  return groups;
};

/** Every entry the history gives, with each time loss merged into a collision or damage entry of its car close by. */
const candidates = (acc: Board): Candidate[] => {
  const closed = CAR_MACHINES.flatMap((machine) => acc.spanEvents[machine]);
  const list = [...closed, ...acc.collisions, ...acc.given, ...acc.openEvents].map((e) =>
    candidate(e.kind, e.at, e.frame, e.carIds, {
      ...(e.id !== undefined && { id: e.id }),
      ...(e.cornerCutting !== undefined && { cornerCutting: e.cornerCutting }),
      ...(e.infringement !== undefined && { infringement: e.infringement }),
      ...(e.penalty !== undefined && { penalty: e.penalty }),
    }),
  );
  for (const { carId, frame, jumps } of damageGroups(acc)) {
    const [jump] = jumps;
    if (jump !== undefined) list.push(candidate('damage', jump.at, frame, [carId], { lap: jump.lap, jump, jumps }));
  }
  const absorbers = list.filter((c) => c.kind === 'collision' || c.kind === 'damage');
  for (const run of standingRuns(acc)) {
    // F1 25 names a collision's two cars in no fixed order, so either one's time loss belongs to it.
    const into = absorbers.filter((c) => c.carIds.includes(run.carId) && Math.abs(c.at - run.at) <= acc.config.mergeMs);
    for (const c of into) c.merged.push(run);
    if (into.length === 0) list.push(candidate('timeLoss', run.at, run.frame, [run.carId], { lap: lapOfProgress(run.startProgress), run }));
  }
  for (const { at, startFrame, lap, neutralisation } of acc.neutralisedNow) list.push(candidate('neutralised', at, startFrame, [], { lap, neutralisation }));
  return list;
};

const runsLoss = (runs: SlowRun[]): Known<Ms> =>
  known(
    runs.reduce((sum, r) => sum + r.lossMs, 0),
    Math.max(...runs.map((r) => r.endAt)),
  );

/** The loss of the car's mini-sector that holds `t`, against its median; none where an open span covers it (`cutOf`). */
const segmentLoss = (acc: Board, id: CarId, t: SessionTime): Known<Ms> => {
  const track = acc.tracks[id];
  const point = track && latestAt(track, t);
  const loss = point && track?.loss[point.progress];
  if (track === undefined || point === undefined || loss === undefined) return unknown('notReceived');
  if (loss === 'excluded' || (track.lossFrame[point.progress] as FrameNumber) > cutOf(acc, id)) return unknown('notApplicable');
  if (loss === 'fewLaps') return unknown('insufficientData');
  return known(loss.lossMs, loss.end);
};

/** `pace-delta` over the car's pace laps around `lap` (the lap itself excluded). */
const paceAround = (acc: Board, id: CarId, lap: number): Known<Ms> => paceDeltaAround(Object.values(acc.current[id] ?? {}), lap, acc);

/** Kinds with no time lost: the car is out, the field is neutralised, or the entry is a ruling, not a loss. */
const NO_TIME_LOST: ReadonlySet<IncidentKind> = new Set(['retirement', 'neutralised', 'warning', 'penalty']);

/**
 * From the mini-sector at once, then from `pace-delta` once there are laps (spec 6.4). The loss is of the car that
 * lost time: the first car, unless only the other car of a collision has a merged time loss.
 */
const timeLost = (acc: Board, c: Candidate, lap: number): Known<Ms> => {
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

const gapKnown = (acc: Board, snap: Snapshot, ours: CarId, other: CarId, at: SessionTime): Known<Ms> => {
  const gap = gapIn(acc.tracks, snap, ours, other);
  return gap === undefined ? unknown('notReceived') : known(gap, at);
};

/**
 * The frame the after snapshot describes: its newest crossing's (C26); every frame so far while the after moment is not
 * in the history yet.
 */
const frameOf = (after: Snapshot | undefined): FrameNumber => {
  if (after === undefined) return Infinity;
  let frame = -Infinity;
  for (const point of after.latest) if (point !== undefined && point.frame > frame) frame = point.frame;
  return frame;
};

/** Whether `id`'s retired span (car-status) opened on or before `frame` (C26). */
const retiredBy = (acc: Board, id: CarId, frame: FrameNumber): boolean => {
  const from = acc.retiredFrom[id] ?? acc.openRetiredFrom[id];
  return from !== undefined && from <= frame;
};

/** Our gap to `other` after the incident: none once it retired, `notReceived` until the after moment is in the history. */
const gapAfter = (acc: Board, after: Snapshot | undefined, ours: CarId, other: CarId, afterAt: SessionTime): Known<Ms> => {
  if (retiredBy(acc, other, frameOf(after))) return unknown('notApplicable');
  return after === undefined ? unknown('notReceived') : gapKnown(acc, after, ours, other, afterAt);
};

/** Per our car that is involved or has an involved car in its neighbourhood: its position and gap before and after. */
const forUsOf = (acc: Board, c: Candidate): IncidentForUs[] => {
  const before = snapshot(acc, c.at);
  const afterAt = c.at + acc.config.afterMs;
  const after = acc.newestAt >= afterAt ? snapshot(acc, afterAt) : undefined;
  const items: IncidentForUs[] = [];
  for (const ours of acc.ours) {
    const concerned =
      c.kind === 'neutralised' ||
      c.carIds.some((id) => id === ours || isNear(acc.tracks, before, ours, id, acc.neighbourhoodMs));
    if (!concerned) continue;
    const other = c.carIds.find((id) => id !== ours);
    const none = unknown('notApplicable');
    items.push({
      ourCarId: ours,
      otherCarId: other === undefined ? none : known(other, c.at),
      positionBefore: positionIn(before, ours, c.at),
      positionAfter: after === undefined ? unknown('notReceived') : positionIn(after, ours, afterAt),
      gapBeforeMs: other === undefined ? none : gapKnown(acc, before, ours, other, c.at),
      gapAfterMs: other === undefined ? none : gapAfter(acc, after, ours, other, afterAt),
    });
  }
  return items;
};

const lapOf = (acc: Board, c: Candidate): number => {
  if (c.lap !== undefined) return c.lap;
  const primary = c.carIds[0];
  return primary === undefined ? 1 : crossingLap(acc, primary, c.at);
};

/** The parts of a damage entry's jumps and their rise, the biggest first; `damage` gives one part per jump. */
const damageParts = (jumps: readonly FinishedJump[]): IncidentDamagePart[] => {
  const rise = new Map<IncidentDamagePart['part'], number>();
  for (const j of jumps) for (const part of j.parts) rise.set(part, (rise.get(part) ?? 0) + j.deltaPct);
  return [...rise].map(([part, deltaPct]) => ({ part, deltaPct })).sort((a, b) => b.deltaPct - a.deltaPct);
};

/**
 * The detail only some kinds have: a damage entry's parts, a corner-cutting warning's count of the limit (the
 * corner-cutting warnings, a penalty every `warningLimit`), another warning's infringement, a penalty's ruling.
 */
const detailOf = (acc: Board, c: Candidate): Pick<IncidentEntry, 'damage' | 'warning' | 'penalty'> => {
  if (c.jumps !== undefined) return { damage: damageParts(c.jumps) };
  if (c.cornerCutting !== undefined) {
    return { warning: { kind: 'cornerCutting', count: warningInCycle(c.cornerCutting, acc.warningLimit), limit: acc.warningLimit } };
  }
  if (c.infringement !== undefined) return { warning: { kind: 'other', infringement: c.infringement } };
  if (c.penalty !== undefined) return { penalty: { ...c.penalty } };
  return {};
};

/** The kinds that can cause a neutralisation. */
const CAUSE_KINDS = new Set(['collision', 'retirement', 'damage', 'timeLoss'] as const satisfies readonly IncidentCause['kind'][]);

const isCauseKind = (kind: IncidentKind): kind is IncidentCause['kind'] => (CAUSE_KINDS as ReadonlySet<IncidentKind>).has(kind);

/** Kinds that follow from a collision of their car: a damage jump or time loss up to `mergeMs` after it is its consequence. */
const CONSEQUENCE_KINDS: ReadonlySet<IncidentKind> = new Set(['damage', 'timeLoss']);

/**
 * Per neutralised candidate, its likely cause: the newest candidate of a cause kind of any car with its time in
 * `[start − causeWindowMs, start]`, among every candidate before the neighbourhood filter; a damage or time loss that
 * is the consequence of a collision of its car in that window names that collision. `sorted` is newest first, ties by
 * id, so the first match is the newest.
 */
const causesOf = (acc: Board, sorted: readonly Candidate[]): Map<string, IncidentCause> => {
  const causes = new Map<string, IncidentCause>();
  for (const n of sorted) {
    if (n.kind !== 'neutralised') continue;
    const inWindow = (c: Candidate): boolean => c.at <= n.at && c.at >= n.at - acc.config.causeWindowMs;
    const newest = sorted.find((c) => isCauseKind(c.kind) && inWindow(c));
    if (newest === undefined) continue;
    const root = CONSEQUENCE_KINDS.has(newest.kind)
      ? sorted.find(
          (c) => c.kind === 'collision' && inWindow(c) && c.at <= newest.at && newest.at - c.at <= acc.config.mergeMs && c.carIds.some((id) => newest.carIds.includes(id)),
        )
      : undefined;
    const cause = root ?? newest;
    if (isCauseKind(cause.kind)) causes.set(n.id, { entryId: cause.id, kind: cause.kind, carIds: [...cause.carIds], at: cause.at });
  }
  return causes;
};

/** The turn at a known fraction (spec 6.2): `notApplicable` without turns in the track file, `insufficientData` with no apex within `turnSnapM`. */
const turnOf = (acc: Board, fraction: Known<LapFraction>, turns: readonly TrackTurn[] | undefined): Known<string> => {
  if (turns === undefined) return unknown('notApplicable');
  if (!fraction.known) return unknown(fraction.reason);
  const label = turnAt(turns, fraction.value, acc.layout.trackLengthM, acc.config.turnSnapM);
  return label === undefined ? unknown('insufficientData') : known(label, fraction.at);
};

/** Where the entry's first car was (spec 6.2): its sector, lap fraction and turn; all `notApplicable` for an entry without a car. */
const whereOf = (acc: Board, c: Candidate, turns: readonly TrackTurn[] | undefined): IncidentWhere => {
  const first = c.carIds[0];
  if (first === undefined) return { sector: unknown('notApplicable'), turn: unknown('notApplicable'), fraction: unknown('notApplicable') };
  const track = acc.tracks[first];
  const fraction = fractionAt(track, c.at, acc.layout.trackLengthM);
  return { sector: sectorAt(track, c.at, acc.layout), turn: turnOf(acc, fraction, turns), fraction };
};

/**
 * Newest first, ties by id; only entries of our cars or their neighbourhood, and the cause of a neutralisation (its
 * `forUs` empty where no car of ours is concerned), cut at `feedLength`. The markers are the major ones of those
 * entries, before the cut, with a known fraction, while the leader is fewer than `markerLaps` laps past the leader's
 * lap at the entry's frame (`leaderLapAt`, C26), at their point on the outline; `notApplicable` without an outline.
 * `where` and the markers read the track file here, never in the fold (C31.2).
 */
const output = (fold: Acc, view: EngineView): IncidentsOutput => {
  if (!behaviourFor(WEEKEND_PHASE, view).includes('feed')) return { feed: [], markers: unknown('notApplicable') };
  const acc: Board = { ...fold, ...nowOf(fold, view) };
  const file = view.track.known ? view.track.value : undefined;
  const turns = file?.turns.known ? file.turns.value : undefined;
  const outline = file?.outline.known ? file.outline.value : undefined;
  const byId = new Map<string, Candidate>();
  for (const c of candidates(acc)) if (!byId.has(c.id)) byId.set(c.id, c);
  const sorted = [...byId.values()].sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const causes = causesOf(acc, sorted);
  const causeIds = new Set([...causes.values()].map((c) => c.entryId));
  const leaderNow = leaderLapAt(acc.lapFrames, Infinity);
  const recent = (c: Candidate): boolean => leaderNow - leaderLapAt(acc.lapFrames, c.frame) < acc.config.markerLaps;
  const feed: IncidentEntry[] = [];
  const markers: MapIncident[] = [];
  for (const c of sorted) {
    const inFeed = feed.length < acc.config.feedLength;
    const major = acc.config[MAJOR[c.kind]];
    const marker = outline !== undefined && major && recent(c);
    if (!inFeed && !marker) continue;
    const forUs = forUsOf(acc, c);
    if (forUs.length === 0 && !causeIds.has(c.id)) continue;
    const where = whereOf(acc, c, turns);
    if (marker && where.fraction.known) markers.push({ point: pointAt(outline, where.fraction.value), kind: c.kind });
    if (!inFeed) continue;
    const cause = causes.get(c.id);
    const lap = lapOf(acc, c);
    feed.push({
      id: c.id,
      at: c.at,
      lap,
      kind: c.kind,
      severity: major ? 'major' : 'minor',
      carIds: [...c.carIds],
      timeLostMs: timeLost(acc, c, lap),
      forUs,
      where,
      ...detailOf(acc, c),
      ...(cause !== undefined && { cause }),
      ...(c.neutralisation !== undefined && { neutralisation: c.neutralisation }),
    });
  }
  return { feed, markers: outline === undefined || !view.track.known ? unknown('notApplicable') : known(markers, view.track.at) };
};

/** The incidents feed of the race: an incremental fold; a flashback starts it over. */
export const incidentsCalculator: IncrementalCalculator<Acc, IncidentsOutput> = {
  id: INCIDENTS,
  kind: 'incremental',
  reads: [
    'session',
    'identity',
    'events',
    ...NEUTRALISATION_READS,
    ...CAR_MACHINES.map((machine): ChangeTag => `spans:${machine}`),
    'spans:weekend-phase',
    'miniSectors',
    'laps',
    'penalties',
  ],
  cadence: { hz: 4 },
  init,
  update: (acc, delta, view) => (delta.rewound !== undefined ? init(view) : fold(acc, view)),
  output,
};
