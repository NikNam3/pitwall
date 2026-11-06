// The `damage` calculator: per car, the damage now and its jumps from the shared grouping of the `damageChange` events
// (`shared/damage-jumps.ts`) and the laps; it shows only the jumps whose part was not repaired (a fall) since. Per jump
// it counts the pace laps measuring its loss and estimates the loss early from the car's mini-sectors since the jump
// against its segment medians frozen at the jump (`shared/segment-medians.ts`, spec 3.5).
import {
  addLaps,
  emptyCurrentLaps,
  known,
  MINI_SECTORS,
  unknown,
  type CarId,
  type Corners,
  type CurrentLaps,
  type DamageParts,
  type DamageState,
  type FrameNumber,
  type Known,
  type LapRecord,
  type MachineId,
  type MiniSectorCrossing,
  type Ms,
  type SessionTime,
  type Span,
} from '@pitwall/domain';
import { openSpansOf, type DeepReadonly, type EngineView, type IncrementalCalculator } from '@pitwall/engine/readers';
import { classifyLap, LAP_CLASSES_CONFIG, type LapClassOptions } from '../lap-classes/index.ts';
import { PACE_CONFIG } from '../pace/index.ts';
import { behaviourFor, openSpansByCar } from '../shared/behaviour.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { MIN_LAPS } from '../pace-delta/index.ts';
import { emptyDamageJumps, finishJump, foldDamageJumps, repairedSince, type DamageJumpFold, type FinishedJump } from '../shared/damage-jumps.ts';
import { isNeutralisation, NEUTRALISATION_MACHINES, NEUTRALISATION_READS } from '../shared/neutralised.ts';
import { carSegmentMedian, foldCarSample, type CarSegmentSamples } from '../shared/segment-medians.ts';
import { DAMAGE_BEHAVIOUR, type DamageEffect } from './behaviour.ts';
import { DAMAGE, DAMAGE_CONFIG, type DamageOutput } from './index.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

/** The car-scoped sub-machine whose spans keep a car's mini-sectors out of the estimate (its pit visits). */
const LOCATION: MachineId = 'car-location';

/** A crossing of a car; "progress" counts mini-sector boundaries from the race start; `frame`: the frame it describes (C26). */
type Point = { at: SessionTime; progress: number; frame: FrameNumber };

/** The frames a closed span covers, `startFrame <= f < endFrame` (C26). */
type Cover = { startFrame: FrameNumber; endFrame: FrameNumber };

/** A mini-sector counted toward a jump's estimate: its end crossing and its loss against the frozen median. */
type Counted = { endFrame: FrameNumber; at: SessionTime; lossMs: Ms };

/**
 * One jump's estimate so far: the segment medians frozen at the jump (set once the first mini-sector ending after its
 * frame is evaluated: no crossing after the jump's frame enters them) and the mini-sectors since the jump counted
 * against them, with their sum.
 */
type JumpEstimate = { frame: FrameNumber; baseline: (Ms | 'fewLaps')[] | undefined; counted: Counted[]; sumMs: Ms };

/** One car's crossings in arrival order and what was evaluated from them. */
type Track = {
  points: Point[];
  /** How many points have had the mini-sector that ends at them evaluated. */
  evaluated: number;
  /** Per segment, the car's last eligible mini-sectors (`foldCarSample`). */
  samples: CarSegmentSamples;
  /** Per jump of the car, by its index in the grouping. */
  estimates: JumpEstimate[];
  /** The evaluation is to start over with the current exclusions and jumps. */
  stale: boolean;
};

type Acc = {
  /** The shared jump grouping over the events folded so far. */
  grouping: DamageJumpFold;
  /** Laps folded so far. */
  lapCount: number;
  /** One record per (car, lap): confirmed over provisional. */
  laps: CurrentLaps;
  /** Crossings folded so far. */
  crossingCount: number;
  /** How many closed spans of each sub-machine with `noSample` rows are folded. */
  closedCount: Record<MachineId, number>;
  /** The closed neutralisations whose row is `noSample`. */
  neutralised: Cover[];
  /** Per car, its closed spans whose row is `noSample` (pit visits, garage spells). */
  visits: Map<CarId, Cover[]>;
  tracks: Map<CarId, Track>;
  jumpPct: number;
  jumpWindowMs: number;
  minEstimateSegments: number;
  maxNeutralisedMs: number;
  window: number;
};

const settings = (view: EngineView) => ({
  ...DAMAGE_CONFIG.read(view),
  ...LAP_CLASSES_CONFIG.read(view),
  window: PACE_CONFIG.read(view).window,
});

/** The row of a span's kind; a kind without one is a bug in the table (C3). */
const rowOf = (machine: MachineId, kind: string): DamageEffect => {
  const byKind = DAMAGE_BEHAVIOUR[machine];
  const row = byKind !== undefined && Object.hasOwn(byKind, kind) ? byKind[kind] : undefined;
  if (row === undefined) throw new Error(`damage behaviour: no row for ${machine} ${kind}`);
  return row;
};

/** The mini-sector from `from` to `to` covers frames `from.frame <= f < to.frame`: it shares one with `span` (C26). */
const sharesFrame = (from: Point, to: Point, span: Cover): boolean => from.frame < span.endFrame && to.frame > span.startFrame;

const emptyTrack = (): Track => ({ points: [], evaluated: 0, samples: [], estimates: [], stale: false });

const trackOf = (acc: Acc, id: CarId): Track => {
  let track = acc.tracks.get(id);
  if (track === undefined) acc.tracks.set(id, (track = emptyTrack()));
  return track;
};

/** The newest frame whose mini-sector the track has evaluated; none before the first. */
const evaluatedFrame = (track: Track): FrameNumber => track.points[track.evaluated - 1]?.frame ?? -Infinity;

const foldLaps = (acc: Acc, view: EngineView): void => {
  const { laps } = view.history;
  addLaps(acc.laps, laps.slice(acc.lapCount) as LapRecord[]);
  acc.lapCount = laps.length;
};

/** Folds the new events; a new jump before what a car's track has evaluated makes that track start over. */
const foldJumps = (acc: Acc, view: EngineView): void => {
  foldDamageJumps(acc.grouping, view.history.events, acc);
  for (const [id, frames] of acc.grouping.frames) {
    const track = trackOf(acc, id);
    for (const frame of frames.slice(track.estimates.length)) {
      track.estimates.push({ frame, baseline: undefined, counted: [], sumMs: 0 });
      if (frame < evaluatedFrame(track)) track.stale = true;
    }
  }
};

/**
 * Folds the new closed spans whose row is `noSample` (C20): a neutralisation (C18: one closed unconfirmed is none) makes
 * every track start over, a car's pit visit or garage spell that car's.
 */
const foldSpans = (acc: Acc, view: EngineView): void => {
  for (const machine of [...NEUTRALISATION_MACHINES, LOCATION]) {
    const list = view.history.spans[machine] ?? [];
    for (let i = acc.closedCount[machine] ?? 0; i < list.length; i++) {
      const span = list[i] as DeepReadonly<Span>;
      if (rowOf(machine, span.kind).noSample !== true) continue;
      const cover = { startFrame: span.startFrame, endFrame: span.endFrame };
      if (machine === LOCATION) {
        if (span.carId === undefined) continue;
        const visits = acc.visits.get(span.carId) ?? [];
        acc.visits.set(span.carId, visits);
        visits.push(cover);
        trackOf(acc, span.carId).stale = true;
      } else if (isNeutralisation(machine, span)) {
        acc.neutralised.push(cover);
        for (const track of acc.tracks.values()) track.stale = true;
      }
    }
    acc.closedCount[machine] = list.length;
  }
};

const foldCrossings = (acc: Acc, view: EngineView): void => {
  const { crossings } = view.history;
  for (let i = acc.crossingCount; i < crossings.length; i++) {
    const c = crossings[i] as DeepReadonly<MiniSectorCrossing>;
    if (c.lap < 1) continue;
    trackOf(acc, c.carId).points.push({ at: c.at, progress: (c.lap - 1) * MINI_SECTORS + c.segment, frame: c.frame });
  }
  acc.crossingCount = crossings.length;
};

/** Forgets what was evaluated from the crossings, so the next `evaluate` starts over. */
const resetTrack = (track: Track): void => {
  track.evaluated = 0;
  track.samples = [];
  for (const est of track.estimates) Object.assign(est, { baseline: undefined, counted: [], sumMs: 0 });
  track.stale = false;
};

/**
 * Evaluates the mini-sectors completed since the last call, each from its start crossing to its end crossing. A jump's
 * baseline freezes at the first crossing after its frame. One that `excluded` covers is no sample; otherwise it counts
 * toward every jump at or before its start crossing's frame whose frozen median of the segment exists (a segment with
 * `fewLaps` is skipped), then becomes a sample. A gap in the crossings is no mini-sector.
 */
const evaluate = (track: Track, excluded: (from: Point, to: Point) => boolean): void => {
  const { points } = track;
  for (let i = track.evaluated; i < points.length; i++) {
    const to = points[i] as Point;
    for (const est of track.estimates) {
      if (est.baseline === undefined && to.frame > est.frame) {
        est.baseline = Array.from({ length: MINI_SECTORS }, (_, segment) => carSegmentMedian(track.samples, segment));
      }
    }
    const from = points[i - 1];
    if (from === undefined || to.progress !== from.progress + 1 || excluded(from, to)) continue;
    const segment = from.progress % MINI_SECTORS;
    const ms = to.at - from.at;
    for (const est of track.estimates) {
      const median = from.frame >= est.frame ? est.baseline?.[segment] : undefined;
      if (median === undefined || median === 'fewLaps') continue;
      est.counted.push({ endFrame: to.frame, at: to.at, lossMs: ms - median });
      est.sumMs += ms - median;
    }
    foldCarSample(track.samples, segment, ms);
  }
  track.evaluated = points.length;
};

/** A pure fold over the events, the laps, the crossings, the closed spans and the config (C31.2). */
const fold = (acc: Acc, view: EngineView): Acc => {
  foldJumps(acc, view);
  foldLaps(acc, view);
  foldSpans(acc, view);
  foldCrossings(acc, view);
  for (const [id, track] of acc.tracks) {
    if (track.stale) resetTrack(track);
    const visits = acc.visits.get(id) ?? [];
    evaluate(track, (from, to) => acc.neutralised.some((n) => sharesFrame(from, to, n)) || visits.some((v) => sharesFrame(from, to, v)));
  }
  return acc;
};

const init = (view: EngineView): Acc =>
  fold(
    {
      grouping: emptyDamageJumps(),
      lapCount: 0,
      laps: emptyCurrentLaps(),
      crossingCount: 0,
      closedCount: {},
      neutralised: [],
      visits: new Map(),
      tracks: new Map(),
      ...settings(view),
    },
    view,
  );

/** A pending weekend phase has no span yet and reads as the race's grid (C14): its row is the race's. */
const GRID = DAMAGE_BEHAVIOUR['weekend-phase']?.race;

/**
 * Per car in the session: its state now without the jumps, its current lap, and its rows (`DAMAGE_BEHAVIOUR`), from the
 * live state and the open spans. Read by `output`, never kept in the accumulator (C31.2).
 */
const carsNow = (view: EngineView): Map<CarId, { state: Omit<DamageState, 'jumps'>; lap: number; effect: DamageEffect }> => {
  const now = new Map<CarId, { state: Omit<DamageState, 'jumps'>; lap: number; effect: DamageEffect }>();
  for (const car of view.live.cars) {
    const effect: DamageEffect = Object.assign({}, GRID, ...behaviourFor(DAMAGE_BEHAVIOUR, view, car.id));
    if (effect.inSession !== true) continue;
    const { bodywork, powerUnit } = car.condition;
    const parts: DamageState['parts'] = !bodywork.known
      ? bodywork
      : !powerUnit.known
        ? powerUnit
        : known<DamageParts>(
            { ...bodywork.value, gearboxPct: powerUnit.value.gearboxDamagePct, enginePct: powerUnit.value.engineDamagePct },
            Math.max(bodywork.at, powerUnit.at),
          );
    const corner = (c: (typeof CORNERS)[number]) => ({
      tyrePct: car.tyres.corners[c].damagePct,
      brakePct: car.condition.brakes[c].damagePct,
    });
    const corners = Object.fromEntries(CORNERS.map((c) => [c, corner(c)])) as Corners<DamageState['corners']['fl']>;
    now.set(car.id, {
      state: { parts, corners, drsFault: car.condition.drsFault, ersFault: car.condition.ersFault },
      lap: car.timing.lap,
      effect,
    });
  }
  return now;
};

/**
 * Per car, the frame from which its open `noSample` spans (C20) cover every frame: the open neutralisation's start and
 * the car's open pit visit or garage spell's, the earlier; `Infinity` with none open. A mini-sector ending after it
 * shares a frame with one (C26).
 */
const openCutOf = (view: EngineView): ((id: CarId) => FrameNumber) => {
  let session = Infinity;
  for (const machine of NEUTRALISATION_MACHINES) {
    for (const span of openSpansOf(view, machine)) {
      if (isNeutralisation(machine, span) && rowOf(machine, span.kind).noSample === true) session = Math.min(session, span.startFrame);
    }
  }
  const byCar = openSpansByCar(view, LOCATION);
  return (id) => {
    let cut = session;
    for (const span of byCar.get(id) ?? []) if (rowOf(LOCATION, span.kind).noSample === true) cut = Math.min(cut, span.startFrame);
    return cut;
  };
};

/**
 * While the loss is measured (`insufficientData`: enough pace laps before the jump, fewer than `pace-delta`'s
 * `MIN_LAPS` after its lap), the pace laps after it so far; `notApplicable` once measured or when it can never be.
 */
const measuringOf = (
  jump: FinishedJump,
  laps: readonly DeepReadonly<LapRecord>[],
  opts: LapClassOptions,
): Known<{ lapsDone: number; lapsNeeded: number }> => {
  if (jump.lossMsPerLap.known || jump.lossMsPerLap.reason !== 'insufficientData') return unknown('notApplicable');
  const after = laps.filter((l) => l.lapNumber > jump.lap && classifyLap(l, opts).forPace);
  return known({ lapsDone: after.length, lapsNeeded: MIN_LAPS }, after[after.length - 1]?.completedAt ?? jump.at);
};

/**
 * The estimate of a jump: the losses of its counted mini-sectors no open span covers (they end at or before `cut`),
 * summed and scaled to a lap of `MINI_SECTORS`, as of the newest one; `insufficientData` below `minSegments`.
 */
const estimateOf = (est: JumpEstimate | undefined, cut: FrameNumber, minSegments: number): Known<Ms> => {
  if (est === undefined) return unknown('insufficientData');
  let n = est.counted.length;
  let sumMs = est.sumMs;
  for (let last = est.counted[n - 1]; last !== undefined && last.endFrame > cut; last = est.counted[n - 1]) {
    sumMs -= last.lossMs;
    n--;
  }
  const newest = est.counted[n - 1];
  if (n < minSegments || newest === undefined) return unknown('insufficientData');
  // whole ms (C4), rounded on the output only, never in the accumulator's sums (C31); `+ 0` turns a −0 into 0
  return known(Math.round((sumMs * MINI_SECTORS) / n) + 0, newest.at);
};

/**
 * Damage now and its jumps not repaired since, per car in the session; a jump's loss is `pace-delta` over the pace laps
 * around it, `notApplicable` where the weekend phase has none to measure (`DAMAGE_BEHAVIOUR`); while it is measured,
 * its pace laps so far; until it is known, its estimate from the mini-sectors since the jump.
 */
export const damageCalculator: IncrementalCalculator<Acc, DamageOutput> = {
  id: DAMAGE,
  kind: 'incremental',
  reads: [
    'condition',
    'tyres',
    'timing',
    'events',
    'laps',
    'miniSectors',
    CAR_STATUS_READS,
    'spans:car-location',
    'spans:weekend-phase',
    ...NEUTRALISATION_READS,
  ],
  cadence: { hz: 4 },
  init,
  update: (acc, delta, view) => (delta.rewound !== undefined ? init(view) : fold(acc, view)),
  output(acc, view) {
    const out: DamageOutput = {};
    const cutOf = openCutOf(view);
    for (const [id, { state, lap, effect }] of carsNow(view)) {
      // integer keys iterate in ascending order: the car's laps by lap number
      const laps = Object.values(acc.laps[id] ?? {});
      const opts = { ...acc, isRace: effect.isRace === true };
      const estimates = acc.tracks.get(id)?.estimates ?? [];
      const cut = cutOf(id);
      const jumps = (acc.grouping.jumps.get(id) ?? []).flatMap((raw, i) => {
        if (repairedSince(acc.grouping, id, raw)) return [];
        const finished = finishJump(raw, laps, lap, opts);
        const jump = effect.measured === true ? finished : { ...finished, lossMsPerLap: unknown('notApplicable') };
        const estimateMsPerLap = jump.lossMsPerLap.known ? unknown('notApplicable') : estimateOf(estimates[i], cut, acc.minEstimateSegments);
        return [{ ...jump, measuring: measuringOf(jump, laps, opts), estimateMsPerLap }];
      });
      out[id] = { ...state, jumps };
    }
    return out;
  },
};
