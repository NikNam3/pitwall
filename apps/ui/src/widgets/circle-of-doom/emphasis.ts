// The circle-of-doom's emphasis (C68; mockup circle-of-doom.html): our car and our teammate white (the teammate a ring),
// every other car grey; the current condition's ghost white, the others faint. Colour only to highlight.
import type { Role } from '../../theme/roles.ts';

/** A car of the field: our teammate or a rival. */
export type CarKind = 'mate' | 'rival';

/** A car's colour: our teammate white, a rival grey. */
export function carRole(kind: CarKind): Role {
  return kind === 'mate' ? 'ownCar' : 'textDim';
}

/** Our car, at the top. */
export function ownRole(): Role {
  return 'ownCar';
}

/** A ghost: the current condition's white, the others faint. */
export function ghostRole(on: boolean): Role {
  return on ? 'ownCar' : 'textFaint';
}

/** The ghost's diamond is filled with the background, so the ring does not show through it. */
export function ghostFillRole(): Role {
  return 'bg';
}

/** The ring. */
export function ringRole(): Role {
  return 'border';
}

/** The gaps line under the rejoin place. */
export function gapsRole(): Role {
  return 'text';
}
