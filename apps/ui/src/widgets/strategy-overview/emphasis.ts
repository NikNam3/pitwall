// The Field plans emphasis (C68; mockup strategy-overview.html: "KUH has the bar, LIN is white"; colour only to
// highlight): the link's car white bold with the bar, the teammate white bold, a rival in the text colour.
import type { Role } from '../../theme/index.ts';

export type RowKind = 'own' | 'mate' | 'rival';
export type RowEmphasis = { role: Role; bold: boolean; bar: boolean };

const ROW: Record<RowKind, RowEmphasis> = {
  own: { role: 'ownCar', bold: true, bar: true },
  mate: { role: 'ownCar', bold: true, bar: false },
  rival: { role: 'text', bold: false, bar: false },
};

/** A row's emphasis by its kind. */
export const rowEmphasis = (kind: RowKind): RowEmphasis => ROW[kind];

/** A stint drawn solid in the lane: white on our rows, dim on a rival's. */
export const solidRole = (own: boolean): Role => (own ? 'ownCar' : 'textDim');

/** A rival's predicted stints, faint. */
export const FAINT_ROLE: Role = 'textFaint';
/** A faint block's opacity (gen.mjs 0.35). */
export const FAINT_OPACITY = 0.35;
/** A rival's window shade (its opacity from lane.ts `windowShade`). */
export const SHADE_ROLE: Role = 'text';
/** Plan B's stop marks and the line under our plan. */
export const MARK_ROLE: Role = 'textDim';
/** The line at now. */
export const NOW_ROLE: Role = 'text';
/** A letter inside a solid block (knocked out of the fill). */
export const SOLID_LETTER_ROLE: Role = 'bg';
