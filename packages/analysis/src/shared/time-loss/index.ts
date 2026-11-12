// The time-loss detection (spec 6.4) as a pure function over the projection (C43, C45): the time-loss, collision and
// damage events per car from the crossings and events alone, the part of `incidents` other units read too, so they
// agree. What a mini-sector is excluded for (a neutralisation, a pit visit) is the caller's, by frames (C26).
import type { CarId, FrameNumber, Ms, SessionTime } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { emptyDamageJumps, foldDamageJumps } from '../damage-jumps.ts';
import { addCrossing, emptyTrack, evaluate, groupDamageJumps, lapOfProgress, latestOnFrame, mergesInto, slowRuns, type SlowRun, type Track } from './track.ts';

export * from './track.ts';

/** `timeLossMs`, `mergeMs`: the `incidents` config's; `jumpPct`, `jumpWindowMs`: the `damage` config's (the jump grouping). */
export type TimeLossConfig = { timeLossMs: Ms; mergeMs: Ms; jumpPct: number; jumpWindowMs: Ms };

/**
 * One event of one car: a time loss (a run of slow mini-sectors), or a collision or damage jump with the loss of the
 * time-loss runs merged into it, else its mini-sector's loss. `frame`: the frame it describes (C26), the run's first
 * crossing's, the collision event's, the first jump's; `lap`: the car's lap there, from its crossings.
 */
export type TimeLossEvent = { carId: CarId; lap: number; frame: FrameNumber; lossMs: Ms; kind: 'timeLoss' | 'collision' | 'damage' };

/** Whether the caller excludes the car's mini-sector from its start crossing's frame to its end crossing's (C26). */
export type TimeLossExcluded = (carId: CarId, fromFrame: FrameNumber, toFrame: FrameNumber) => boolean;

/** A collision or damage event of one car before its loss is known. */
type Absorber = { carId: CarId; at: SessionTime; frame: FrameNumber; kind: 'collision' | 'damage'; merged: SlowRun[] };

/** Every car's track from the crossings, evaluated against the caller's exclusions. */
const tracksOf = (history: Pick<EngineView['history'], 'crossings'>, timeLossMs: Ms, excluded: TimeLossExcluded): (Track | undefined)[] => {
  const tracks: (Track | undefined)[] = [];
  for (const c of history.crossings) if (c.lap >= 1) addCrossing((tracks[c.carId] ??= emptyTrack()), c);
  tracks.forEach((track, id) => {
    if (track !== undefined) evaluate(track, timeLossMs, (from, to) => excluded(id as CarId, from.frame, to.frame));
  });
  return tracks;
};

/** One per car of every collision, and per car its damage jumps grouped (`groupDamageJumps`). */
const absorbersOf = (history: Pick<EngineView['history'], 'events'>, config: TimeLossConfig): Absorber[] => {
  const list: Absorber[] = [];
  for (const e of history.events) {
    if (e.kind !== 'collision' || e.carId === undefined) continue;
    for (const carId of e.otherCarId === undefined ? [e.carId] : [e.carId, e.otherCarId]) list.push({ carId, at: e.at, frame: e.frame, kind: 'collision', merged: [] });
  }
  const grouping = emptyDamageJumps();
  foldDamageJumps(grouping, history.events, config);
  const jumps = [...grouping.jumps]
    .flatMap(([carId, raws]) => raws.map((jump, i) => ({ carId, jump, frame: grouping.frames.get(carId)?.[i] as FrameNumber })))
    .sort((a, b) => a.jump.at - b.jump.at || a.carId - b.carId);
  for (const { carId, frame, jumps: [first] } of groupDamageJumps(jumps, config.jumpWindowMs)) {
    if (first !== undefined) list.push({ carId, at: first.at, frame, kind: 'damage', merged: [] });
  }
  return list;
};

/**
 * The time-loss, collision and damage events of every car in the history, in frame order, ties by car id. A time-loss
 * run within `mergeMs` of a collision or damage event of its car is that event's loss, no event of its own. A collision
 * or damage event without a merged run carries the loss of the car's mini-sector it lies in; one whose loss cannot be
 * measured (no median yet, excluded, not complete) is dropped, never given a made-up loss (C3).
 */
export function timeLossEvents(history: Pick<EngineView['history'], 'crossings' | 'events'>, config: TimeLossConfig, excluded: TimeLossExcluded): TimeLossEvent[] {
  const tracks = tracksOf(history, config.timeLossMs, excluded);
  const absorbers = absorbersOf(history, config);
  const out: TimeLossEvent[] = [];
  tracks.forEach((track, id) => {
    if (track === undefined) return;
    for (const run of slowRuns(id as CarId, track.slow)) {
      const into = absorbers.filter((a) => a.carId === run.carId && mergesInto(run.at, a.at, config.mergeMs));
      for (const a of into) a.merged.push(run);
      if (into.length === 0) out.push({ carId: run.carId, lap: lapOfProgress(run.startProgress), frame: run.frame, lossMs: run.lossMs, kind: 'timeLoss' });
    }
  });
  for (const a of absorbers) {
    const track = tracks[a.carId];
    const point = track && latestOnFrame(track, a.frame);
    if (track === undefined || point === undefined) continue;
    const segment = track.loss[point.progress];
    const lossMs = a.merged.length > 0 ? a.merged.reduce((sum, r) => sum + r.lossMs, 0) : typeof segment === 'object' ? segment.lossMs : undefined;
    if (lossMs !== undefined) out.push({ carId: a.carId, lap: lapOfProgress(point.progress), frame: a.frame, lossMs, kind: a.kind });
  }
  return out.sort((a, b) => a.frame - b.frame || a.carId - b.carId);
}
