// The undercut card's emphasis (C68; memory "colour only to highlight"): our own line white bold (the own-car role),
// a rival's line the text colour.
import type { Role } from '../../theme/roles.ts';

export type Emphasis = { role: Role; bold: boolean };

/** A line's emphasis: ours white bold, a rival's plain. */
export const lineEmphasis = (own: boolean): Emphasis => (own ? { role: 'ownCar', bold: true } : { role: 'text', bold: false });
