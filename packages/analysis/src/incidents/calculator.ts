// The `incidents` calculator (spec 6.4): a fold over the events, the spans of the sub-machines it reads (C20), laps and
// mini-sector crossings into `incidents.feed`, by its behaviour table (`behaviour.ts`, C44): the race from the weekend
// phase (C14), the neutralisations from the session-phase spans (through `shared/neutralised.ts`), pit visits from
// car-location, retirements and disqualifications from car-status, penalties and warnings from their spans. A span is
// matched to a mini-sector by frames (C26). Positions and gaps before and after, and the sector, come from the
// crossings, so a flashback reproduces them. A log: it reads the history only, never another analysis's output (C45);
// its damage entries come from the shared jump grouping over the `damageChange` events (`shared/damage-jumps.ts`) and
// stay through a repair.
import {
  addLaps,
  emptyCurrentLaps,
  known,
  unknown,
  type CarId,
  type CurrentLaps,
  type FrameNumber,
  type DamageJump,
  type IncidentDamagePart,
  type IncidentEntry,
  type IncidentForUs,
  type IncidentKind,
  type IncidentPenalty,
  type Known,
  type LapRecord,
  type MachineId,
  type Ms,
  type OpenSpan,
  type PendingPenaltyDetail,
  type SessionTime,
  type Span,
  type WarnedDetail,
} from '@pitwall/domain';
import { openSpansOf, type ChangeTag, type DeepReadonly, type EngineView, type IncrementalCalculator } from '@pitwall/engine/readers';
import { ALARMS_CONFIG } from '../alarms/index.ts';
import { DAMAGE_CONFIG } from '../damage/index.ts';
import { GAPS_CONFIG } from '../gaps/index.ts';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PACE_CONFIG } from '../pace/index.ts';
import { paceDeltaAround } from '../pace-delta/index.ts';
import { emptyDamageJumps, finishJump, foldDamageJumps, type DamageJumpFold } from '../shared/damage-jumps.ts';
import { isClosed, leaderLapAt, NEUTRALISATION_READS, neutralisedSpans } from '../shared/neutralised.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { ourCars } from '../shared/our-cars.ts';
import { warningInCycle } from '../shared/penalties.ts';
import { behaviourOf, INCIDENTS_BEHAVIOUR } from './behaviour.ts';
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

/** `warnings`: on a warning, the warned span's count of the car's warnings; `penalty`: on a penalty, its ruling. */
type CarEvent = {
  kind: 'collision' | 'retirement' | 'warning' | 'penalty';
  at: SessionTime;
  carIds: CarId[];
  warnings?: number;
  penalty?: IncidentPenalty;
};

/**
 * A neutralisation (`shared/neutralised.ts`): its start, the leader's lap at its start frame (ruling 3, from the
 * projection's laps) and the frames it covers, `startFrame <= f < endFrame` (C26; an open one ends at `Infinity`).
 */
type Neutralised = { at: SessionTime; lap: number; startFrame: FrameNumber; endFrame: FrameNumber };

/** The car-scoped sub-machines whose spans `incidents` folds (C20). */
const CAR_MACHINES = ['car-location', 'car-status', 'penalties', 'warnings'] as const satisfies readonly MachineId[];
type CarMachine = (typeof CAR_MACHINES)[number];

/** The weekend phase's rows alone: whether the feed holds anything (C14). */
const WEEKEND_PHASE = { 'weekend-phase': INCIDENTS_BEHAVIOUR['weekend-phase'] };

/** A car's span of row `noTimeLoss` (a pit visit, a garage spell): the frames it covers, `startFrame <= f < endFrame` (C26). */
type Visit = { startFrame: FrameNumber; endFrame: FrameNumber };

/** What a car owes in a penalties span (its detail; none of it in `clear`). */
type Owed = { driveThroughs: number; stopGos: number; totalMs: Ms };

type CarSpan = DeepReadonly<Span> | DeepReadonly<OpenSpan>;

type Acc = {
  /** How much of each history list is folded. */
  events: number;
  crossings: number;
  laps: number;
  /** How many closed spans of each car sub-machine are folded. */
  closed: Record<CarMachine, number>;
  /** Per car id. */
  tracks: (Track | undefined)[];
  /** The neutralisations, closed then open, as of the latest fold. */
  neutralised: Neutralised[];
  /** Per car id, its closed pit visits and garage spells, by frame. */
  visits: Visit[][];
  /** Per car id, the start frame of its open pit visit or garage spell, as of the latest fold. */
  openVisits: (FrameNumber | undefined)[];
  /** The collisions (events) and the entries of the closed spans. */
  carEvents: CarEvent[];
  /** The entries of the open spans, as of the latest fold. */
  openEvents: CarEvent[];
  /** Per car id, what it owed in its latest closed penalties span. */
  owed: (Owed | undefined)[];
  /** Per car id, the frame its first closed retired span opened on. */
  retiredFrom: (FrameNumber | undefined)[];
  /** Per car id, the frame its open retired span opened on, as of the latest fold. */
  openRetiredFrom: (FrameNumber | undefined)[];
  current: CurrentLaps;
  /** The shared jump grouping over the events folded so far: every jump, repaired or not. */
  grouping: DamageJumpFold;
  /** The newest crossing time; a moment up to it is final in the history. */
  newestAt: SessionTime;
  /** Positions at final moments. */
  snapshots: Map<SessionTime, Snapshot>;
  // From the latest view.
  ours: CarId[];
  isRace: boolean;
  layout: TrackLayout;
  config: Config;
  neighbourhoodMs: Ms;
  window: number;
  /** Neutralised time a pace lap stays below (the `lap-classes` config). */
  maxNeutralisedMs: number;
  /** Rises of a part that add up to this are a jump (the damage config). */
  jumpPct: number;
  /** Rises of a part within this window add up; damage jumps of a car this close to the first one are one entry. */
  jumpWindowMs: Ms;
  /** Warnings before a penalty (the alarms' config). */
  warningLimit: number;
};

/** The mini-sector from crossing `from` to crossing `to` covers frames `from.frame <= f < to.frame`: it shares one with `span` (C26). */
const sharesFrame = (from: Point, to: Point, span: { startFrame: FrameNumber; endFrame: FrameNumber }): boolean =>
  from.frame < span.endFrame && to.frame > span.startFrame;

const readLive = (acc: Acc, view: EngineView): void => {
  const { live } = view;
  acc.isRace = behaviourFor(WEEKEND_PHASE, view).includes('feed');
  const { trackLengthM, sector2StartM, sector3StartM } = live.session;
  acc.layout = { trackLengthM, sector2StartM, sector3StartM };
  acc.config = INCIDENTS_CONFIG.read(view);
  const { jumpPct, jumpWindowMs } = DAMAGE_CONFIG.read(view);
  acc.jumpPct = jumpPct;
  acc.jumpWindowMs = jumpWindowMs;
  acc.warningLimit = ALARMS_CONFIG.read(view).warningsBeforePenalty;
  acc.neighbourhoodMs = GAPS_CONFIG.read(view).neighbourhoodMs;
  acc.window = PACE_CONFIG.read(view).window;
  acc.maxNeutralisedMs = LAP_CLASSES_CONFIG.read(view).maxNeutralisedMs;
  acc.ours = ourCars(live);
};

/**
 * The neutralisations of the view (`shared/neutralised.ts`); whether the frames they cover changed (one opened, closed,
 * or went, as a neutralisation never confirmed does, C18). A neutralisation's leader lap is taken from the projection's
 * laps once, then raised by the laps folded after it that describe a frame up to its start, so it equals
 * `leaderLapAt` over the whole projection (C31).
 */
const foldNeutralised = (acc: Acc, view: EngineView): boolean => {
  const { laps } = view.history;
  const fresh = laps.slice(acc.laps);
  const before = acc.neutralised;
  const lapAt = new Map(before.map((n) => [n.startFrame, n.lap]));
  const spans = neutralisedSpans(view.history, view.situation).filter((span) => behaviourOf(span.machine, span.kind) === 'neutralised');
  acc.neutralised = spans.map((span) => {
    const folded = lapAt.get(span.startFrame);
    return {
      at: span.start,
      lap: folded === undefined ? leaderLapAt(laps, span.startFrame) : Math.max(folded, leaderLapAt(fresh, span.startFrame)),
      startFrame: span.startFrame,
      endFrame: isClosed(span) ? span.endFrame : Infinity,
    };
  });
  const now = acc.neutralised;
  return now.length !== before.length || now.some((n, i) => n.startFrame !== before[i]?.startFrame || n.endFrame !== before[i]?.endFrame);
};

/** What the car owes in a penalties span: its detail's counts and total, none of them in `clear`. */
const owedOf = (span: CarSpan): Owed => {
  const detail = (span.detail ?? {}) as Partial<PendingPenaltyDetail>;
  return { driveThroughs: detail.driveThroughs ?? 0, stopGos: detail.stopGos ?? 0, totalMs: detail.totalMs ?? 0 };
};

/** The penalties given between the car's previous penalties span (`before`) and this one: each count or total that rose. */
const risesOf = (before: Owed | undefined, now: Owed): IncidentPenalty[] => {
  const was = before ?? { driveThroughs: 0, stopGos: 0, totalMs: 0 };
  const given: IncidentPenalty[] = [];
  if (now.driveThroughs > was.driveThroughs) given.push({ kind: 'driveThrough' });
  if (now.stopGos > was.stopGos) given.push({ kind: 'stopGo' });
  if (now.totalMs > was.totalMs) given.push({ kind: 'time', timeMs: now.totalMs - was.totalMs });
  return given;
};

/**
 * The entries a car's span gives by its row (C44), at its start: none for a span the engine joined in (its incident was
 * not seen) or one closed unconfirmed (C18); a penalties span's from what rose over the car's previous one (`before`).
 */
const entriesOf = (machine: CarMachine, span: CarSpan, before: Owed | undefined): CarEvent[] => {
  if (span.carId === undefined || span.joinedAt === true || ('endFrame' in span && !span.confirmed)) return [];
  const base = { at: span.start, carIds: [span.carId] };
  switch (behaviourOf(machine, span.kind)) {
    case 'retirement':
      return [{ kind: 'retirement', ...base }];
    case 'disqualification':
      return [{ kind: 'penalty', ...base, penalty: { kind: 'disqualified' } }];
    case 'warning':
      return [{ kind: 'warning', ...base, warnings: (span.detail as WarnedDetail).count }];
    case 'penalty':
      return risesOf(before, owedOf(span)).map((penalty) => ({ kind: 'penalty', ...base, penalty }));
    default:
      return [];
  }
};

/**
 * Folds the closed spans of the car sub-machines new in the projection, in their order (a car's spans are contiguous, so
 * each one's predecessor is the car's latest folded one), and reads the open ones of the situation (C20). Returns the
 * cars whose pit visits or garage spells changed.
 */
const foldCarSpans = (acc: Acc, view: EngineView): Set<CarId> => {
  const changed = new Set<CarId>();
  for (const machine of CAR_MACHINES) {
    const list = view.history.spans[machine] ?? [];
    for (const span of list.slice(acc.closed[machine])) {
      const id = span.carId;
      if (id === undefined) continue;
      const row = behaviourOf(machine, span.kind);
      if (row === 'noTimeLoss') {
        (acc.visits[id] ??= []).push({ startFrame: span.startFrame, endFrame: span.endFrame });
        changed.add(id);
      }
      if (row === 'retirement' && span.confirmed) acc.retiredFrom[id] ??= span.startFrame;
      acc.carEvents.push(...entriesOf(machine, span, acc.owed[id]));
      if (machine === 'penalties') acc.owed[id] = owedOf(span);
    }
    acc.closed[machine] = list.length;
  }

  const openVisits: (FrameNumber | undefined)[] = [];
  acc.openRetiredFrom = [];
  acc.openEvents = [];
  for (const machine of CAR_MACHINES) {
    for (const span of openSpansOf(view, machine)) {
      const id = span.carId;
      if (id === undefined) continue;
      const row = behaviourOf(machine, span.kind);
      if (row === 'noTimeLoss') openVisits[id] = span.startFrame;
      if (row === 'retirement') acc.openRetiredFrom[id] = span.startFrame;
      acc.openEvents.push(...entriesOf(machine, span, acc.owed[id]));
    }
  }
  const cars = Math.max(openVisits.length, acc.openVisits.length);
  for (let id = 0; id < cars; id++) if (openVisits[id] !== acc.openVisits[id]) changed.add(id as CarId);
  acc.openVisits = openVisits;
  return changed;
};

/**
 * Folds the new crossings; a change of a car's pit visits or garage spells (`visitsChanged`) re-evaluates its
 * crossings, and a change of the neutralisations (`neutralisedChanged`) every car's, so the fold equals a run from
 * scratch (C31). A mini-sector is no time loss when it shares a frame with a neutralisation or one of its car's visits
 * (C26).
 */
const foldCrossings = (acc: Acc, view: EngineView, neutralisedChanged: boolean, visitsChanged: ReadonlySet<CarId>): void => {
  const { crossings } = view.history;
  for (const c of crossings.slice(acc.crossings)) {
    if (c.lap < 1) continue;
    addCrossing((acc.tracks[c.carId] ??= emptyTrack()), c);
    if (c.at > acc.newestAt) acc.newestAt = c.at;
  }
  acc.crossings = crossings.length;

  acc.tracks.forEach((track, id) => {
    if (track === undefined) return;
    if (neutralisedChanged || visitsChanged.has(id as CarId)) resetTrack(track);
    const open = acc.openVisits[id];
    const visits = open === undefined ? (acc.visits[id] ?? []) : [...(acc.visits[id] ?? []), { startFrame: open, endFrame: Infinity }];
    evaluate(
      track,
      acc.config.timeLossMs,
      (from, to) => acc.neutralised.some((n) => sharesFrame(from, to, n)) || visits.some((v) => sharesFrame(from, to, v)),
    );
  });
};

/** Folds the new collisions and damage changes; retirements, penalties and warnings come from the spans (C13, C20). */
const foldEvents = (acc: Acc, view: EngineView): void => {
  const { events } = view.history;
  for (const e of events.slice(acc.events)) {
    if (e.carId === undefined || e.kind !== 'collision') continue;
    const carIds = e.otherCarId === undefined ? [e.carId] : [e.carId, e.otherCarId];
    acc.carEvents.push({ kind: 'collision', at: e.at, carIds });
  }
  acc.events = events.length;
  foldDamageJumps(acc.grouping, events, acc);
};

const foldLaps = (acc: Acc, view: EngineView): void => {
  const { laps } = view.history;
  addLaps(acc.current, laps.slice(acc.laps) as LapRecord[]);
  acc.laps = laps.length;
};

const fold = (acc: Acc, view: EngineView): Acc => {
  readLive(acc, view);
  const neutralisedChanged = foldNeutralised(acc, view);
  foldCrossings(acc, view, neutralisedChanged, foldCarSpans(acc, view));
  foldEvents(acc, view);
  foldLaps(acc, view);
  return acc;
};

const init = (view: EngineView): Acc =>
  fold(
    {
      events: 0,
      crossings: 0,
      laps: 0,
      closed: { 'car-location': 0, 'car-status': 0, penalties: 0, warnings: 0 },
      tracks: [],
      neutralised: [],
      visits: [],
      openVisits: [],
      carEvents: [],
      openEvents: [],
      owed: [],
      retiredFrom: [],
      openRetiredFrom: [],
      current: emptyCurrentLaps(),
      grouping: emptyDamageJumps(),
      newestAt: -Infinity,
      snapshots: new Map(),
      ours: [],
      isRace: false,
      layout: { trackLengthM: 0, sector2StartM: 0, sector3StartM: 0 },
      config: INCIDENTS_CONFIG.read(view),
      neighbourhoodMs: 0,
      window: 0,
      maxNeutralisedMs: 0,
      jumpPct: 0,
      jumpWindowMs: 0,
      warningLimit: 0,
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
  /** The first damage jump of a damage entry, and every jump of it. */
  jump?: DamageJump;
  jumps?: DamageJump[];
  /** A warning entry's count of the car's warnings. */
  warnings?: number;
  /** A penalty entry's ruling. */
  penalty?: IncidentPenalty;
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

/** The car's lap at `t` from its crossings; lap 1 before its first one. */
const crossingLap = (acc: Acc, id: CarId, t: SessionTime): number => {
  const point = snapshot(acc, t).latest[id];
  return point === undefined ? 1 : lapOfProgress(point.progress);
};

/** The time loss runs that stand, minus those still running into a pit visit or garage spell the car is in now (its open span). */
const standingRuns = (acc: Acc): SlowRun[] =>
  acc.tracks.flatMap((track, id) => {
    if (track === undefined) return [];
    const runs = slowRuns(id as CarId, track);
    const newest = track.points[track.points.length - 1]?.progress;
    return acc.openVisits[id] !== undefined ? runs.filter((r) => r.endProgress !== newest) : runs;
  });

/** Every damage jump of every car, repaired or not, with its lap and loss (the lap from the crossings without a lap record). */
const allJumps = (acc: Acc): { carId: CarId; jump: DamageJump }[] =>
  [...acc.grouping.jumps].flatMap(([carId, raws]) => {
    // integer keys iterate in ascending order: the car's laps by lap number
    const laps = Object.values(acc.current[carId] ?? {});
    return raws.map((raw) => ({ carId, jump: finishJump(raw, laps, crossingLap(acc, carId, raw.at), acc) }));
  });

/** Each car's damage jumps grouped: a jump within `jumpWindowMs` of a group's first one joins it (one incident, several parts). */
const damageGroups = (acc: Acc): { carId: CarId; jumps: DamageJump[] }[] => {
  const groups: { carId: CarId; jumps: DamageJump[] }[] = [];
  const open = new Map<CarId, { carId: CarId; jumps: DamageJump[] }>();
  const sorted = allJumps(acc).sort((a, b) => a.jump.at - b.jump.at || a.carId - b.carId);
  for (const { carId, jump } of sorted) {
    const group = open.get(carId);
    const first = group?.jumps[0];
    if (group !== undefined && first !== undefined && jump.at - first.at <= acc.jumpWindowMs) {
      group.jumps.push(jump);
      continue;
    }
    const fresh = { carId, jumps: [jump] };
    open.set(carId, fresh);
    groups.push(fresh);
  }
  return groups;
};

/** Every entry the history gives, with each time loss merged into a collision or damage entry of its car close by. */
const candidates = (acc: Acc): Candidate[] => {
  const list = [...acc.carEvents, ...acc.openEvents].map((e) =>
    candidate(e.kind, e.at, e.carIds, {
      ...(e.warnings !== undefined && { warnings: e.warnings }),
      ...(e.penalty !== undefined && { penalty: e.penalty }),
    }),
  );
  for (const { carId, jumps } of damageGroups(acc)) {
    const [jump] = jumps;
    if (jump !== undefined) list.push(candidate('damage', jump.at, [carId], { lap: jump.lap, jump, jumps }));
  }
  const absorbers = list.filter((c) => c.kind === 'collision' || c.kind === 'damage');
  for (const run of standingRuns(acc)) {
    // F1 25 names a collision's two cars in no fixed order, so either one's time loss belongs to it.
    const into = absorbers.filter((c) => c.carIds.includes(run.carId) && Math.abs(c.at - run.at) <= MERGE_MS);
    for (const c of into) c.merged.push(run);
    if (into.length === 0) list.push(candidate('timeLoss', run.at, [run.carId], { lap: lapOfProgress(run.startProgress), run }));
  }
  for (const { at, lap } of acc.neutralised) list.push(candidate('neutralised', at, [], { lap }));
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
const retiredBy = (acc: Acc, id: CarId, frame: FrameNumber): boolean => {
  const from = acc.retiredFrom[id] ?? acc.openRetiredFrom[id];
  return from !== undefined && from <= frame;
};

/** Our gap to `other` after the incident: none once it retired, `notReceived` until the after moment is in the history. */
const gapAfter = (acc: Acc, after: Snapshot | undefined, ours: CarId, other: CarId, afterAt: SessionTime): Known<Ms> => {
  if (retiredBy(acc, other, frameOf(after))) return unknown('notApplicable');
  return after === undefined ? unknown('notReceived') : gapKnown(acc, after, ours, other, afterAt);
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

const lapOf = (acc: Acc, c: Candidate): number => {
  if (c.lap !== undefined) return c.lap;
  const primary = c.carIds[0];
  return primary === undefined ? 1 : crossingLap(acc, primary, c.at);
};

/** The parts of a damage entry's jumps and their rise, the biggest first; `damage` gives one part per jump. */
const damageParts = (jumps: readonly DamageJump[]): IncidentDamagePart[] => {
  const rise = new Map<IncidentDamagePart['part'], number>();
  for (const j of jumps) for (const part of j.parts) rise.set(part, (rise.get(part) ?? 0) + j.deltaPct);
  return [...rise].map(([part, deltaPct]) => ({ part, deltaPct })).sort((a, b) => b.deltaPct - a.deltaPct);
};

/** The detail only some kinds have: a damage entry's parts, a warning's count of the limit, a penalty's ruling. */
const detailOf = (acc: Acc, c: Candidate): Pick<IncidentEntry, 'damage' | 'warning' | 'penalty'> => {
  if (c.jumps !== undefined) return { damage: damageParts(c.jumps) };
  if (c.warnings !== undefined) return { warning: { count: warningInCycle(c.warnings, acc.warningLimit), limit: acc.warningLimit } };
  if (c.penalty !== undefined) return { penalty: { ...c.penalty } };
  return {};
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
      where: { sector: c.carIds[0] === undefined ? unknown('notApplicable') : sectorAt(acc.tracks[c.carIds[0]], c.at, acc.layout) },
      ...detailOf(acc, c),
    });
  }
  return feed;
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
  ],
  cadence: { hz: 4 },
  init,
  update: (acc, delta, view) => (delta.rewound !== undefined ? init(view) : fold(acc, view)),
  output,
};
