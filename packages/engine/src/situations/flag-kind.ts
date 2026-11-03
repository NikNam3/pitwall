// The span kind of a game flag, shared by the car-flags and zone-flags sub-machines (both read the game's `ZoneFlag`).
import type { ZoneFlag } from '@pitwall/domain';

export type FlagKind = 'noFlag' | 'green' | 'blue' | 'yellow' | 'unknown';

/** The game's "none" is `noFlag`; its "invalid/unknown" is `unknown` (C3). */
export const flagKind = (flag: ZoneFlag): FlagKind => (flag === 'none' ? 'noFlag' : flag);

/** Every change of flag is a transition from one kind to another, and every kind is the first of a scope. */
export const FLAG_KINDS: readonly FlagKind[] = ['noFlag', 'green', 'blue', 'yellow', 'unknown'];
export const FLAG_TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ...FLAG_KINDS.map((to) => ['none', to] as const),
  ...FLAG_KINDS.flatMap((from) => FLAG_KINDS.filter((to) => to !== from).map((to) => [from, to] as const)),
];
