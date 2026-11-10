import type { Corners } from '@pitwall/domain';
import { cornersFromGameOrder } from '../util/hot-domain.ts';

export const CORNER_NAMES = ['fl', 'fr', 'rl', 'rr'] as const;
export type CornerName = (typeof CORNER_NAMES)[number];

/** Builds one value per named corner. */
export const mapCorners = <T>(make: (corner: CornerName) => T): Corners<T> => ({
  fl: make('fl'),
  fr: make('fr'),
  rl: make('rl'),
  rr: make('rr'),
});

/** Each corner's index in a per-wheel array of a packet (game order RL, RR, FL, FR, C5). */
const GAME_INDEX: Readonly<Record<CornerName, number>> = { rl: 0, rr: 1, fl: 2, fr: 3 };

/** One corner's entry of a per-wheel array of a packet, as `cornersOf` names it, without building the four. A missing entry reads as 0. */
export const cornerOf = (wheels: readonly number[], corner: CornerName): number => wheels[GAME_INDEX[corner]] ?? 0;

/** Names a per-wheel array of a packet (game order RL, RR, FL, FR). A missing entry reads as 0. */
export const cornersOf = (wheels: readonly number[]): Corners<number> =>
  cornersFromGameOrder([wheels[0] ?? 0, wheels[1] ?? 0, wheels[2] ?? 0, wheels[3] ?? 0]);
