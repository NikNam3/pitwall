// `incidents` maths (spec 6.4): each car's mini-sector track, the losses against its median, and positions and gaps
// at a past moment, all from the crossings alone (engine convention: segment 0 of lap L is the line at its start).
import {
  known,
  MINI_SECTORS,
  unknown,
  type CarId,
  type Known,
  type MiniSectorCrossing,
  type Ms,
  type SessionState,
  type SessionTime,
} from '@pitwall/domain';
import { gapBehind, progressOf, type CarCrossings } from '../gaps/gaps.ts';

/** The median of a segment is taken over the car's last this many laps that have it... */
export const MEDIAN_LAPS = 5;
/** ...and needs at least this many. */
export const MEDIAN_MIN_LAPS = 3;

/** A stretch of session time that is no racing for a car: a neutralised phase (an open one ends at `Infinity`) or a pit visit. */
export type Span = { start: SessionTime; end: SessionTime };

/** A crossing; "progress" counts mini-sector boundaries from the race start (gaps' `progressOf`). */
export type Point = { at: SessionTime; progress: number };

/** One mini-sector against the car's median for its segment: `lossMs` negative = faster. */
export type MiniSector = { start: SessionTime; end: SessionTime; progress: number; lossMs: Ms };

/** What one complete mini-sector gave: a loss, or why there is none. */
export type SegmentLoss = MiniSector | 'excluded' | 'fewLaps';

/** One car's crossings in arrival (time) order and what was folded from them. */
export type Track = {
  points: Point[];
  /** Crossing time by progress; sparse. */
  atByProgress: SessionTime[];
  /** How many points have had the mini-sector that ends at them evaluated. */
  evaluated: number;
  /** Per segment, the durations of its last eligible mini-sectors, oldest first. */
  samples: Ms[][];
  /** By the progress of a mini-sector's start; absent until the mini-sector is complete. */
  loss: SegmentLoss[];
  /** Every slow mini-sector, in order. */
  slow: MiniSector[];
};

/** Consecutive slow mini-sectors of one car: one time loss from the first one's start. */
export type SlowRun = { carId: CarId; at: SessionTime; endAt: SessionTime; startProgress: number; endProgress: number; lossMs: Ms };

/** Every car's latest crossing at one moment and the positions it gives, indexed by car id. */
export type Snapshot = { latest: (Point | undefined)[]; position: (number | undefined)[]; count: number };

export const lapOfProgress = (progress: number): number => Math.floor(progress / MINI_SECTORS) + 1;

export const emptyTrack = (): Track => ({ points: [], atByProgress: [], evaluated: 0, samples: [], loss: [], slow: [] });

/** Forgets what was folded from the crossings, so the next `evaluate` starts over with the current exclusions. */
export function resetTrack(track: Track): void {
  track.evaluated = 0;
  track.samples = [];
  track.loss = [];
  track.slow = [];
}

export function addCrossing(track: Track, c: MiniSectorCrossing): void {
  const progress = progressOf(c);
  track.points.push({ at: c.at, progress });
  track.atByProgress[progress] = c.at;
}

/** The `k`-th smallest of a few values (0-based), by counting; no sorted copy, since it runs for every mini-sector. */
const kth = (values: readonly Ms[], k: number): Ms => {
  for (const v of values) {
    let less = 0;
    let lessOrEqual = 0;
    for (const w of values) {
      if (w < v) less++;
      if (w <= v) lessOrEqual++;
    }
    if (less <= k && k < lessOrEqual) return v;
  }
  return NaN;
};

const median = (values: readonly Ms[]): Ms => {
  const mid = values.length >> 1;
  return values.length % 2 === 1 ? kth(values, mid) : (kth(values, mid - 1) + kth(values, mid)) / 2;
};

/**
 * Evaluates the mini-sectors completed since the last call: one `excluded` covers is neither a loss nor a sample;
 * otherwise its loss is its duration minus the median of the segment's samples, and it is slow above `timeLossMs`.
 * A gap in the crossings (a skipped segment) is no mini-sector.
 */
export function evaluate(track: Track, timeLossMs: Ms, excluded: (start: SessionTime, end: SessionTime) => boolean): void {
  let from = track.points[track.evaluated - 1];
  for (const to of track.points.slice(track.evaluated)) {
    const prev = from;
    from = to;
    if (prev === undefined || to.progress !== prev.progress + 1) continue;
    const { progress, at: start } = prev;
    if (excluded(start, to.at)) {
      track.loss[progress] = 'excluded';
      continue;
    }
    const samples = (track.samples[progress % MINI_SECTORS] ??= []);
    const ms = to.at - start;
    if (samples.length >= MEDIAN_MIN_LAPS) {
      const sector = { start, end: to.at, progress, lossMs: ms - median(samples) };
      track.loss[progress] = sector;
      if (sector.lossMs > timeLossMs) track.slow.push(sector);
    } else track.loss[progress] = 'fewLaps';
    samples.push(ms);
    if (samples.length > MEDIAN_LAPS) samples.shift();
  }
  track.evaluated = track.points.length;
}

/** The car's slow mini-sectors grouped into runs of consecutive ones. */
export function slowRuns(carId: CarId, track: Track): SlowRun[] {
  const runs: SlowRun[] = [];
  let run: SlowRun | undefined;
  for (const s of track.slow) {
    if (run !== undefined && run.endProgress === s.progress) {
      run.endProgress = s.progress + 1;
      run.endAt = s.end;
      run.lossMs += s.lossMs;
      continue;
    }
    run = { carId, at: s.start, endAt: s.end, startProgress: s.progress, endProgress: s.progress + 1, lossMs: s.lossMs };
    runs.push(run);
  }
  return runs;
}

/** The car's latest crossing at or before `t`. */
export function latestAt(track: Track, t: SessionTime): Point | undefined {
  let lo = 0;
  let hi = track.points.length - 1;
  let found: Point | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const point = track.points[mid];
    if (point !== undefined && point.at <= t) {
      found = point;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Every car's latest crossing at `t`, ranked by progress, then the earlier crossing, then car id. */
export function snapshotAt(tracks: readonly (Track | undefined)[], t: SessionTime): Snapshot {
  const snap: Snapshot = { latest: [], position: [], count: 0 };
  const ranked: { id: number; point: Point }[] = [];
  tracks.forEach((track, id) => {
    const point = track && latestAt(track, t);
    if (point === undefined) return;
    snap.latest[id] = point;
    ranked.push({ id, point });
  });
  ranked.sort((a, b) => b.point.progress - a.point.progress || a.point.at - b.point.at || a.id - b.id);
  ranked.forEach(({ id }, i) => (snap.position[id] = i + 1));
  snap.count = ranked.length;
  return snap;
}

/** The car's position in the snapshot at `at`; `notReceived` for a car without a crossing yet (no position is invented). */
export function positionIn(snap: Snapshot, id: CarId, at: SessionTime): Known<number> {
  const position = snap.position[id];
  return position === undefined ? unknown('notReceived') : known(position, at);
}

/** The track's crossings from progress `from` up to its point in the snapshot, in the shape `gaps` reads. */
const crossingsUpTo = (track: Track, from: number, point: Point): CarCrossings => ({
  fromProgress: from,
  at: track.atByProgress.slice(from, point.progress + 1),
});

/**
 * The gap of car `a` behind car `b` in the snapshot (negative = `a` is ahead): gaps' `gapBehind` over the crossings
 * up to the snapshot. `undefined` when one has no crossing or the shared point is missing.
 */
export function gapIn(tracks: readonly (Track | undefined)[], snap: Snapshot, a: CarId, b: CarId): Ms | undefined {
  const pa = snap.latest[a];
  const pb = snap.latest[b];
  const ta = tracks[a];
  const tb = tracks[b];
  if (pa === undefined || pb === undefined || ta === undefined || tb === undefined) return undefined;
  // the last point both passed is the nearer one: only the crossings from there on are needed
  const from = Math.min(pa.progress, pb.progress);
  const gap = gapBehind(crossingsUpTo(ta, from, pa), crossingsUpTo(tb, from, pb));
  return gap.known ? gap.value : undefined;
}

/** The track's length and where its sectors 2 and 3 start, from the session. */
export type TrackLayout = Pick<SessionState, 'trackLengthM' | 'sector2StartM' | 'sector3StartM'>;

/**
 * The sector the car was in at `t`: its lap distance from its latest crossing at or before `t`, interpolated towards
 * the next crossing (at the mini-sector start while that is not in yet). `notReceived` before its first crossing or
 * while the session has no sector distances.
 */
export function sectorAt(track: Track | undefined, t: SessionTime, layout: TrackLayout): Known<1 | 2 | 3> {
  const { trackLengthM, sector2StartM, sector3StartM } = layout;
  const point = track && latestAt(track, t);
  if (track === undefined || point === undefined || !(trackLengthM > 0 && sector2StartM > 0 && sector3StartM > sector2StartM)) {
    return unknown('notReceived');
  }
  const nextAt = track.atByProgress[point.progress + 1];
  const fraction = nextAt !== undefined && nextAt > point.at ? Math.min(1, (t - point.at) / (nextAt - point.at)) : 0;
  const distanceM = (((point.progress % MINI_SECTORS) + fraction) * trackLengthM) / MINI_SECTORS;
  return known(distanceM < sector2StartM ? 1 : distanceM < sector3StartM ? 2 : 3, t);
}

/** Whether `other` is in the neighbourhood of `ours` in the snapshot: one position away or within `neighbourhoodMs`. */
export function isNear(tracks: readonly (Track | undefined)[], snap: Snapshot, ours: CarId, other: CarId, neighbourhoodMs: Ms): boolean {
  const po = snap.position[ours];
  const pc = snap.position[other];
  if (po !== undefined && pc !== undefined && Math.abs(po - pc) <= 1) return true;
  const gap = gapIn(tracks, snap, ours, other);
  return gap !== undefined && Math.abs(gap) <= neighbourhoodMs;
}
