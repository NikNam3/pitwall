// The plan board's emphasis (C68; mockup docs/design/2026-11-16-sp4.3d/plan-board.html): the active slot white with the
// bar; an infeasible slot faint; a ΔPOS below −1 place amber; a rejected field amber; the headers and the DP rule faint.
// Colour only to highlight: nothing else takes a role.
import type { Role } from '../../theme/roles.ts';

/** The header line and the DP rule. */
export const headerRole: Role = 'textFaint';

/** The active line is white; an infeasible line faint; every other line keeps the inherited colour. */
export function lineRole(active: boolean, faint: boolean): Role | undefined {
  if (active) return 'ownCar';
  return faint ? 'textFaint' : undefined;
}

/** A ΔPOS below −1 place is amber. */
export function deltaRole(places: number): Role | undefined {
  return places < -1 ? 'warning' : undefined;
}

/** A field of a rejected draft (C73). */
export const rejectedRole: Role = 'warning';

/** The dim parts: the `L` before a lap field, `= A`. */
export const dimRole: Role = 'textDim';
