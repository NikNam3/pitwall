import type { UnknownReason } from '@pitwall/domain';
import { role } from '../../theme/index.ts';
import { unknownMark, unknownReason } from '../text.ts';

/** How an unknown value shows in a cell: its reason's mark, in the faint colour, with the reason on hover (Task P). */
export type UnknownShown = { text: string; title: string; colour: string };

/** The one way an unknown value shows: `Value`, `TextCell` and `UnknownMark` render it. */
export const unknownShown = (reason: UnknownReason): UnknownShown => ({
  text: unknownMark[reason],
  title: unknownReason[reason],
  colour: role('textFaint'),
});

/** The reason's hover text, or none for a known value; for a cell that draws its unknown otherwise (the kit `Bar`). */
export const unknownTitle = (reason: UnknownReason | undefined): string | undefined =>
  reason === undefined ? undefined : unknownReason[reason];
