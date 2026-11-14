import type { Corners } from '@pitwall/domain';

export const CORNER_NAMES = ['fl', 'fr', 'rl', 'rr'] as const;
export type CornerName = (typeof CORNER_NAMES)[number];

/** Builds one value per named corner. */
export const mapCorners = <T>(make: (corner: CornerName) => T): Corners<T> => ({
  fl: make('fl'),
  fr: make('fr'),
  rl: make('rl'),
  rr: make('rr'),
});

/**
 * Each corner, in `CORNER_NAMES`' order, with its index in a per-wheel array of a packet (game order RL, RR, FL, FR,
 * C5): `wheels[index] ?? 0` is the corner's entry as `cornersOf` names it, read without building the four.
 */
export const CORNER_SLOTS: ReadonlyArray<readonly [CornerName, number]> = [
  ['fl', 2],
  ['fr', 3],
  ['rl', 0],
  ['rr', 1],
];

/**
 * Names a per-wheel array of a packet (game order RL, RR, FL, FR, C5): each corner at its `CORNER_SLOTS` index; the
 * only place that order is translated (C6). A missing entry reads as 0.
 */
export const cornersOf = (wheels: readonly number[]): Corners<number> => ({
  fl: wheels[2] ?? 0,
  fr: wheels[3] ?? 0,
  rl: wheels[0] ?? 0,
  rr: wheels[1] ?? 0,
});
