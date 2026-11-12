// One car's mini-sector track and its losses against its median (spec 6.4), from the crossings alone (engine
// convention: segment 0 of lap L is the line at its start). Shared by `incidents` and `timeLossEvents` (C45).
import { MINI_SECTORS, type CarId, type FrameNumber, type MiniSectorCrossing, type Ms, type SessionTime } from '@pitwall/domain';
import { progressOf } from '../../gaps/gaps.ts';
import { carSegmentMedian, foldCarSample, type CarSegmentSamples } from '../segment-medians.ts';

/** A crossing; "progress" counts mini-sector boundaries from the race start (gaps' `progressOf`); `frame`: the frame it describes (C26). */
export type Point = { at: SessionTime; progress: number; frame: FrameNumber };

/**
 * One mini-sector against the car's median for its segment: `lossMs` negative = faster; `startFrame`, `endFrame`: its
 * start and end crossings' frames (C26).
 */
export type MiniSector = { start: SessionTime; end: SessionTime; startFrame: FrameNumber; endFrame: FrameNumber; progress: number; lossMs: Ms };

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
  samples: CarSegmentSamples;
  /** By the progress of a mini-sector's start; absent until the mini-sector is complete. */
  loss: SegmentLoss[];
  /** By the progress of a mini-sector's start: the frame of its end crossing (C26), set with its `loss`. */
  lossFrame: FrameNumber[];
  /** Every slow mini-sector, in order. */
  slow: MiniSector[];
};

/** Consecutive slow mini-sectors of one car: one time loss from the first one's start (on frame `frame`, C26). */
export type SlowRun = { carId: CarId; at: SessionTime; frame: FrameNumber; endAt: SessionTime; startProgress: number; endProgress: number; lossMs: Ms };

export const lapOfProgress = (progress: number): number => Math.floor(progress / MINI_SECTORS) + 1;

export const emptyTrack = (): Track => ({ points: [], atByProgress: [], evaluated: 0, samples: [], loss: [], lossFrame: [], slow: [] });

/** Forgets what was folded from the crossings, so the next `evaluate` starts over with the current exclusions. */
export function resetTrack(track: Track): void {
  track.evaluated = 0;
  track.samples = [];
  track.loss = [];
  track.lossFrame = [];
  track.slow = [];
}

export function addCrossing(track: Track, c: MiniSectorCrossing): void {
  const progress = progressOf(c);
  track.points.push({ at: c.at, progress, frame: c.frame });
  track.atByProgress[progress] = c.at;
}

/**
 * Evaluates the mini-sectors completed since the last call, each from its start crossing to its end crossing: one
 * `excluded` covers is neither a loss nor a sample; otherwise its loss is its duration minus the median of the
 * segment's samples, and it is slow above `timeLossMs`. A gap in the crossings (a skipped segment) is no mini-sector.
 */
export function evaluate(track: Track, timeLossMs: Ms, excluded: (from: Point, to: Point) => boolean): void {
  let from = track.points[track.evaluated - 1];
  for (const to of track.points.slice(track.evaluated)) {
    const prev = from;
    from = to;
    if (prev === undefined || to.progress !== prev.progress + 1) continue;
    const { progress, at: start } = prev;
    track.lossFrame[progress] = to.frame;
    if (excluded(prev, to)) {
      track.loss[progress] = 'excluded';
      continue;
    }
    const segment = progress % MINI_SECTORS;
    const ms = to.at - start;
    const med = carSegmentMedian(track.samples, segment);
    if (med !== 'fewLaps') {
      const sector = { start, end: to.at, startFrame: prev.frame, endFrame: to.frame, progress, lossMs: ms - med };
      track.loss[progress] = sector;
      if (sector.lossMs > timeLossMs) track.slow.push(sector);
    } else track.loss[progress] = 'fewLaps';
    foldCarSample(track.samples, segment, ms);
  }
  track.evaluated = track.points.length;
}

/** The car's slow mini-sectors (in order) grouped into runs of consecutive ones. */
export function slowRuns(carId: CarId, slow: readonly MiniSector[]): SlowRun[] {
  const runs: SlowRun[] = [];
  let run: SlowRun | undefined;
  for (const s of slow) {
    if (run !== undefined && run.endProgress === s.progress) {
      run.endProgress = s.progress + 1;
      run.endAt = s.end;
      run.lossMs += s.lossMs;
      continue;
    }
    run = { carId, at: s.start, frame: s.startFrame, endAt: s.end, startProgress: s.progress, endProgress: s.progress + 1, lossMs: s.lossMs };
    runs.push(run);
  }
  return runs;
}

/** The car's latest point whose `key` (its time or its frame) is at or before `t`; points are in both orders. */
const latestBy = (track: Track, key: 'at' | 'frame', t: number): Point | undefined => {
  let lo = 0;
  let hi = track.points.length - 1;
  let found: Point | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const point = track.points[mid];
    if (point !== undefined && point[key] <= t) {
      found = point;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
};

/** The car's latest crossing at or before `t`. */
export const latestAt = (track: Track, t: SessionTime): Point | undefined => latestBy(track, 'at', t);

/** The car's latest crossing on or before frame `frame` (C26). */
export const latestOnFrame = (track: Track, frame: FrameNumber): Point | undefined => latestBy(track, 'frame', frame);

/** Whether a time loss starting at `runAt` belongs to an event of its car at `eventAt`: within `mergeMs` of it. */
export const mergesInto = (runAt: SessionTime, eventAt: SessionTime, mergeMs: Ms): boolean => Math.abs(eventAt - runAt) <= mergeMs;

/**
 * Each car's damage jumps (sorted by time, ties by car id) grouped: a jump within `jumpWindowMs` of a group's first one
 * joins it (one incident, several parts); a group describes its first jump's frame (C26).
 */
export function groupDamageJumps<J extends { at: SessionTime }>(
  sorted: readonly { carId: CarId; jump: J; frame: FrameNumber }[],
  jumpWindowMs: Ms,
): { carId: CarId; frame: FrameNumber; jumps: J[] }[] {
  const groups: { carId: CarId; frame: FrameNumber; jumps: J[] }[] = [];
  const open = new Map<CarId, { carId: CarId; frame: FrameNumber; jumps: J[] }>();
  for (const { carId, jump, frame } of sorted) {
    const group = open.get(carId);
    const first = group?.jumps[0];
    if (group !== undefined && first !== undefined && jump.at - first.at <= jumpWindowMs) {
      group.jumps.push(jump);
      continue;
    }
    const fresh = { carId, frame, jumps: [jump] };
    open.set(carId, fresh);
    groups.push(fresh);
  }
  return groups;
}
