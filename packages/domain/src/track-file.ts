// A track file (C62b, spec 3.1): one per track id in `data/tracks/<trackId>.json`, committed, produced outside pitwall.
// Every lap position is a lap fraction: the game's track length and coordinate frame differ from the real track's, so
// a fraction times the session's `trackLengthM` is the game's lap distance. Every part is `Known`, so a file carries
// only what exists for its track.
import type { Known } from './known.ts';
import type { Metres, Ms } from './units.ts';

/** A position on the lap, in `[0, 1)`; times the session's `trackLengthM` it is the game's lap distance. */
export type LapFraction = number;

/** A point of the track map: in the unit square, y down, rotated for display. */
export type MapPoint = { x: number; y: number };

/** A turn of the track: its number, an optional letter (`9a`), the label shown, and its apex on the lap. */
export type TrackTurn = { number: number; letter?: string; label: string; apex: LapFraction };

/** A braking zone on the lap; it may wrap past the line (`start > end`). */
export type BrakingZone = { start: LapFraction; end: LapFraction };

/** A default a run starts from, with where it came from (`"FastF1 3.x, 2025 <event> R, median of n stops"`). */
export type TrackDefault<T> = { value: T; source: string };

/** A track's data as the view holds it (`view.track`): the file without its provenance. */
export type TrackData = {
  trackId: number;
  name: string;
  realLengthM: Known<Metres>;
  /** 500 points at equal lap fractions; point i at i/500. */
  outline: Known<MapPoint[]>;
  /** In lap order. */
  turns: Known<TrackTurn[]>;
  /** In lap order, disjoint; a zone may wrap past the line (start > end). */
  brakingZones: Known<BrakingZone[]>;
  defaults: {
    pitLossMs: { green: Known<TrackDefault<Ms>>; vsc: Known<TrackDefault<Ms>>; sc: Known<TrackDefault<Ms>> };
    /** Relative to medium = 0. */
    compoundOffsetsMs: Known<TrackDefault<{ soft: Ms; medium: Ms; hard: Ms }>>;
  };
};

/** The file as committed and as the sidecar: the data plus its provenance. */
export type TrackFile = TrackData & {
  source: { generator: string; fastf1: string; season: number; generatedOn: string };
};

/** Checks parsed JSON against `TrackFile`: every part's shape, every lap fraction in `[0, 1)`, every `Ms` an integer. */
export function validateTrackFile(json: unknown): { ok: true; file: TrackFile } | { ok: false; errors: string[] } {
  void json;
  throw new Error('not implemented');
}

/** The file's data without its provenance (`source`), as `view.track` holds it (C35). */
export function trackDataOf(file: TrackFile): TrackData {
  void file;
  throw new Error('not implemented');
}
