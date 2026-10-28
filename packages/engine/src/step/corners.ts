import { cornersFromGameOrder, type Corners } from '@pitwall/domain';

export const CORNER_NAMES = ['fl', 'fr', 'rl', 'rr'] as const;
export type CornerName = (typeof CORNER_NAMES)[number];

/** Builds one value per named corner. */
export const mapCorners = <T>(make: (corner: CornerName) => T): Corners<T> => ({
  fl: make('fl'),
  fr: make('fr'),
  rl: make('rl'),
  rr: make('rr'),
});

/** Names a per-wheel array of a packet (game order RL, RR, FL, FR). A missing entry reads as 0. */
export const cornersOf = (wheels: readonly number[]): Corners<number> =>
  cornersFromGameOrder([wheels[0] ?? 0, wheels[1] ?? 0, wheels[2] ?? 0, wheels[3] ?? 0]);
