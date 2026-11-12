// `incidents` maths (spec 6.4): positions and gaps at a past moment and where a car was, from the crossings alone
// (engine convention: segment 0 of lap L is the line at its start). Each car's mini-sector track and its losses against
// its median are the shared time-loss detection's (`shared/time-loss/`, C45).
import { known, MINI_SECTORS, unknown, type CarId, type Known, type LapFraction, type Metres, type Ms, type SessionState, type SessionTime } from '@pitwall/domain';
import { gapBehind, type CarCrossings } from '../gaps/gaps.ts';
import { latestAt, type Point, type Track } from '../shared/time-loss/index.ts';
import { fractionOf } from '../shared/track-lookup.ts';

/** Every car's latest crossing at one moment and the positions it gives, indexed by car id. */
export type Snapshot = { latest: (Point | undefined)[]; position: (number | undefined)[]; count: number };

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

/**
 * Where the car was on the lap at `t` (spec 6.2): its lap distance interpolated by time between its latest crossing at
 * or before `t` and the next one, as a lap fraction of the session's track length. `insufficientData` before its first
 * crossing and while the next crossing is not in the history yet; `notReceived` while the session has no track length.
 */
export function fractionAt(track: Track | undefined, t: SessionTime, trackLengthM: Metres): Known<LapFraction> {
  const point = track && latestAt(track, t);
  const nextAt = point && track?.atByProgress[point.progress + 1];
  if (point === undefined || nextAt === undefined || !(nextAt > point.at)) return unknown('insufficientData');
  const share = Math.min(1, (t - point.at) / (nextAt - point.at));
  const fraction = fractionOf((((point.progress % MINI_SECTORS) + share) * trackLengthM) / MINI_SECTORS, trackLengthM);
  return fraction === undefined ? unknown('notReceived') : known(fraction, t);
}

/** Whether `other` is in the neighbourhood of `ours` in the snapshot: one position away or within `neighbourhoodMs`. */
export function isNear(tracks: readonly (Track | undefined)[], snap: Snapshot, ours: CarId, other: CarId, neighbourhoodMs: Ms): boolean {
  const po = snap.position[ours];
  const pc = snap.position[other];
  if (po !== undefined && pc !== undefined && Math.abs(po - pc) <= 1) return true;
  const gap = gapIn(tracks, snap, ours, other);
  return gap !== undefined && Math.abs(gap) <= neighbourhoodMs;
}
