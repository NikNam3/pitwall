// PACE Δ of `battle` (live polish spec 3.1, contract C26, C31, C43): the accumulator folds each car's current mini-sector
// crossings of its last 4 laps, the closed pit-lane and garage spans and the closed neutralisations, all from the
// projection (C31.2); `paceDelta` adds the open spans of the situation (C20) and compares two cars over the same last 50
// mini-sectors.
import {
  foldCurrentCrossing,
  known,
  MINI_SECTORS,
  unknown,
  type CarId,
  type CrossingIndex,
  type FrameNumber,
  type Known,
  type MachineId,
  type MiniSectorCrossing,
  type Ms,
  type Span,
} from '@pitwall/domain';
import { openSpansOf, type DeepReadonly, type EngineView } from '@pitwall/engine/readers';
import { isNeutralisation, NEUTRALISATION_MACHINES } from '../shared/neutralised.ts';
import { skipsSegments, type SegmentMachine } from './behaviour.ts';

const CAR_LOCATION = 'car-location';

/** The laps of a car's crossings the accumulator keeps: the window's 3-lap reach plus one lap. */
const KEPT_LAPS = 4;
/** How far back the window reaches from its end: 3 laps of segments. */
const REACH = 3 * MINI_SECTORS;

/** The frames a span covers: from the one it opened on up to, not including, the one it closed on (C26); open: no end. */
type Frames = { startFrame: FrameNumber; endFrame: FrameNumber };

/** Battle's accumulator: a pure fold over projection entries (C31.2). */
export type BattleAcc = {
  /** The projection entries folded so far: crossings, and the spans of each machine read. */
  folded: { crossings: number; spans: Record<MachineId, number> };
  /** Each car's current crossings of its last `KEPT_LAPS` laps, by car, lap and segment (`foldCurrentCrossing`). */
  crossings: CrossingIndex;
  /** Each car's closed spans off the track (pit lane, garage). */
  offTrack: Map<CarId, Frames[]>;
  /** The closed neutralisations of the session, as `shared/neutralised.ts` counts them. */
  neutralised: Frames[];
};

export const emptyBattleAcc = (): BattleAcc => ({
  folded: { crossings: 0, spans: {} },
  crossings: new Map(),
  offTrack: new Map(),
  neutralised: [],
});

/** Drops a car's laps older than its newest lap's last `KEPT_LAPS`. */
function trim(byLap: Map<number, (MiniSectorCrossing | undefined)[]>): void {
  let newest = -Infinity;
  for (const lap of byLap.keys()) if (lap > newest) newest = lap;
  for (const lap of [...byLap.keys()]) if (lap <= newest - KEPT_LAPS) byLap.delete(lap);
}

/** The closed spans of `machine` after the ones folded already, in order. */
function newSpans(acc: BattleAcc, view: EngineView, machine: MachineId): DeepReadonly<Span>[] {
  const list = view.history.spans[machine] ?? [];
  const from = acc.folded.spans[machine] ?? 0;
  acc.folded.spans[machine] = list.length;
  const spans: DeepReadonly<Span>[] = [];
  for (let i = from; i < list.length; i++) spans.push(list[i] as DeepReadonly<Span>);
  return spans;
}

/** Folds the projection entries after the folded ones into `acc`. Mutates and returns `acc`. */
export function foldBattle(acc: BattleAcc, view: EngineView): BattleAcc {
  const { crossings } = view.history;
  const touched = new Set<CarId>();
  for (let i = acc.folded.crossings; i < crossings.length; i++) {
    const c = crossings[i] as MiniSectorCrossing;
    foldCurrentCrossing(acc.crossings, c);
    touched.add(c.carId);
  }
  acc.folded.crossings = crossings.length;
  for (const [id, byLap] of acc.crossings) if (touched.has(id)) trim(byLap);

  for (const span of newSpans(acc, view, CAR_LOCATION)) {
    if (span.carId === undefined || !skipsSegments(CAR_LOCATION, span.kind)) continue;
    const list = acc.offTrack.get(span.carId) ?? [];
    acc.offTrack.set(span.carId, list);
    list.push({ startFrame: span.startFrame, endFrame: span.endFrame });
  }
  for (const machine of NEUTRALISATION_MACHINES) {
    for (const span of newSpans(acc, view, machine)) {
      if (isNeutralisation(machine, span) && skipsSegments(machine as SegmentMachine, span.kind)) {
        acc.neutralised.push({ startFrame: span.startFrame, endFrame: span.endFrame });
      }
    }
  }
  return acc;
}

/** The open spans (C20) of the session that skip segments: the open neutralisations. */
export function openNeutralised(view: EngineView): Frames[] {
  const open: Frames[] = [];
  for (const machine of NEUTRALISATION_MACHINES) {
    for (const span of openSpansOf(view, machine)) {
      if (isNeutralisation(machine, span) && skipsSegments(machine as SegmentMachine, span.kind)) open.push({ startFrame: span.startFrame, endFrame: Infinity });
    }
  }
  return open;
}

/** A car's spans off the track, the closed ones of `acc` and its open one (C20). */
function offTrackOf(acc: BattleAcc, view: EngineView, id: CarId): Frames[] {
  const spans = [...(acc.offTrack.get(id) ?? [])];
  for (const span of openSpansOf(view, CAR_LOCATION, id)) if (skipsSegments(CAR_LOCATION, span.kind)) spans.push({ startFrame: span.startFrame, endFrame: Infinity });
  return spans;
}

/** A car's crossings, looked up by their count of segments from (1, 0). */
type Track = { byLap: ReadonlyMap<number, readonly (MiniSectorCrossing | undefined)[]>; newest: number };

const mod = (n: number): number => ((n % MINI_SECTORS) + MINI_SECTORS) % MINI_SECTORS;

const passOf = (track: Track, index: number): MiniSectorCrossing | undefined =>
  track.byLap.get(Math.floor(index / MINI_SECTORS) + 1)?.[mod(index)];

function trackOf(acc: BattleAcc, id: CarId): Track | undefined {
  const byLap = acc.crossings.get(id);
  if (byLap === undefined) return undefined;
  let newest = -Infinity;
  for (const [lap, slots] of byLap) {
    for (let segment = slots.length - 1; segment >= 0; segment--) {
      if (slots[segment] === undefined) continue;
      newest = Math.max(newest, (lap - 1) * MINI_SECTORS + segment);
      break;
    }
  }
  return newest === -Infinity ? undefined : { byLap, newest };
}

/** A pass of a boundary: its count of segments from (1, 0) and its crossing. */
type Pass = { index: number; crossing: MiniSectorCrossing };

/** A car's newest pass of boundary `boundary` (0 to 49); none among its kept laps. */
function newestPassOf(track: Track, boundary: number): Pass | undefined {
  const lowest = track.newest - (KEPT_LAPS + 1) * MINI_SECTORS;
  for (let index = track.newest - mod(track.newest - boundary); index >= lowest; index -= MINI_SECTORS) {
    const crossing = passOf(track, index);
    if (crossing !== undefined) return { index, crossing };
  }
  return undefined;
}

/**
 * Where the window ends: the newest boundary both cars crossed. Of the two cars' newest boundaries, the one whose
 * older pass (by the two cars' own newest passes of it) is the later; each car's index of its own newest pass of it.
 */
function windowEnd(ours: Track, theirs: Track): { ours: Pass; theirs: Pass } | undefined {
  let best: { ours: Pass; theirs: Pass; older: number } | undefined;
  for (const boundary of [mod(ours.newest), mod(theirs.newest)]) {
    const o = newestPassOf(ours, boundary);
    const t = newestPassOf(theirs, boundary);
    if (o === undefined || t === undefined) continue;
    const older = Math.min(o.crossing.at, t.crossing.at);
    if (best === undefined || older > best.older) best = { ours: o, theirs: t, older };
  }
  return best;
}

/** The ms a car took over the segment ending at its pass `end`; none when a crossing is missing or a span skips it (C26). */
function segmentMs(track: Track, end: number, skips: readonly Frames[]): number | undefined {
  const from = passOf(track, end - 1);
  const to = passOf(track, end);
  if (from === undefined || to === undefined) return undefined;
  if (skips.some((s) => from.frame < s.endFrame && to.frame > s.startFrame)) return undefined;
  return to.at - from.at;
}

/**
 * PACE Δ of `ourId` against `theirId` (spec 3.1): their time minus ours over the same last 50 usable mini-sectors,
 * normalised to one lap, rounded to the ms; positive = we are faster. The window ends at the newest boundary both
 * cars crossed and reaches back at most 3 laps; a segment is skipped when either car's own pass of it shares a frame
 * with its own span off the track or with a neutralisation (`neutralised`, closed and open). Fewer than `minSegments`
 * usable: `insufficientData`.
 */
export function paceDelta(acc: BattleAcc, view: EngineView, neutralised: readonly Frames[], ourId: CarId, theirId: CarId, minSegments: number): Known<Ms> {
  const ours = trackOf(acc, ourId);
  const theirs = trackOf(acc, theirId);
  const end = ours === undefined || theirs === undefined ? undefined : windowEnd(ours, theirs);
  if (ours === undefined || theirs === undefined || end === undefined) return unknown('insufficientData');
  const ourSkips = [...offTrackOf(acc, view, ourId), ...neutralised];
  const theirSkips = [...offTrackOf(acc, view, theirId), ...neutralised];
  let segments = 0;
  let sum = 0;
  for (let back = 0; back < REACH && segments < MINI_SECTORS; back++) {
    const our = segmentMs(ours, end.ours.index - back, ourSkips);
    if (our === undefined) continue;
    const their = segmentMs(theirs, end.theirs.index - back, theirSkips);
    if (their === undefined) continue;
    sum += their - our;
    segments++;
  }
  if (segments === 0 || segments < minSegments) return unknown('insufficientData');
  const at = Math.max(end.ours.crossing.at, end.theirs.crossing.at);
  // `+ 0` turns a rounded −0 into 0
  return known((Math.round((sum * MINI_SECTORS) / segments) + 0) as Ms, at);
}
