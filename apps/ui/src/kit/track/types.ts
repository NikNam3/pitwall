// The scene the kit's track canvas draws (spec 7.1), and where `layoutTrack` places it. Points are map points (the unit
// square, y down); every placed coordinate is CSS px in the canvas box.
import type { LapFraction, MapPoint } from '@pitwall/domain';
import type { Role } from '../../theme/index.ts';

/** A stretch of the outline from one lap fraction to another, redrawn in `role` (a flagged zone). */
export type TrackStretch = { start: LapFraction; end: LapFraction; role: Role };

/** A text at a point of the outline (a turn, a sector), placed outside the bend there. */
export type TrackLabel = { text: string; at: MapPoint };

/** A car: `colour` is `carColour`'s result (team colours are no roles); `bar` attaches a side bar in that role. */
export type TrackDot = {
  id: string;
  at: MapPoint;
  colour: { colour: string; ownCar: boolean };
  radiusPx: number;
  hollow: boolean;
  bar?: Role;
};

/** A triangle at a point with its label beside it (an incident). */
export type TrackMarker = { at: MapPoint; label: string; role: Role };

/** A ghost ring at a point (a rejoin ghost), with its letter right of it, or none. */
export type TrackGhost = { at: MapPoint; letter: string | undefined };

/** Everything the canvas draws. */
export type TrackScene = {
  outline: MapPoint[];
  lineRole: Role;
  stretches: TrackStretch[];
  labels: TrackLabel[];
  dots: TrackDot[];
  markers: TrackMarker[];
  ghosts: TrackGhost[];
};

/** The scene placed in a box: the outline's fit (`toPx`), and the labels, side bars and marker labels in px. */
export type Placed = {
  scene: TrackScene;
  toPx(p: MapPoint): { x: number; y: number };
  labels: { text: string; x: number; y: number }[];
  bars: { x: number; y: number; w: 3; h: 12; role: Role; dotId: string }[];
  markerLabels: { text: string; x: number; y: number }[];
};
