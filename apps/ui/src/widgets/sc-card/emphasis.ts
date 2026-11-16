// The Box call's emphasis (C68; mockup docs/design/2026-11-16-sp4.3d/sc-card.html): the condition that is out is named
// in the warning role; each block's best row is white (bold in the display); a ΔPOS below −1 place is amber; "no set" and
// the headers are faint. Colour only to highlight: nothing else takes a role.
import type { Role } from '../../theme/roles.ts';

/** The full sheet's header lines. */
export const headerRole: Role = 'textFaint';

/** The role of the condition that is out, named in its block's label. */
export function outRole(): Role {
  return 'warning';
}

/** The best row is white; every other row keeps the inherited colour. */
export function bestRole(best: boolean): Role | undefined {
  return best ? 'ownCar' : undefined;
}

/** A ΔPOS below −1 place is amber. */
export function deltaRole(ePosDelta: number): Role | undefined {
  return ePosDelta < -1 ? 'warning' : undefined;
}

/** An answer without a set left is faint. */
export function noSetRole(): Role {
  return 'textFaint';
}
