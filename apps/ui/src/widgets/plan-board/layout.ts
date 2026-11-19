// The plan board's cell budget (mockup docs/design/2026-11-16-sp4.3d/plan-board.html, gen.mjs `boardSpec`; SP4.3d2
// Task 12, run log R16): the column widths per variant and mode, and the lines of the planning round, so every variant
// fits the declared sizes (widget.ts: full 82×13, compact 37×7).
//  - width: the lead cell, SLOT, then per column its cells and one gap cell before it. Full live: SLOT 3, STOPS 23,
//    E[POS] 9, ΔPOS 6, ΔTIME 6, the places strip (20), the action 8: 82 cells. Full planning adds START (5, its header;
//    the compound letter left in it) and narrows the rest: STOPS 21 (three stops `L11 H · L23 H · L35 S`), ΔPOS 5,
//    ΔTIME 5, the action 6 (`accept`, `→ slot`): 82 cells. Compact (both variants): SLOT, STOPS 15, E[POS], ΔPOS: 37;
//  - lines, full planning (SP4.3f Task 11, mockup docs/design/2026-11-18-sp4.3f/plan-board-conditions.html round 2):
//    the two inputs lines, the header, one line per slot (a saved plan, a prefill or an empty game slot's entry: five at
//    most), the DP rule, the DP lines and the last line (`save` with a rejection, or the actions or the picker), pinned
//    at the bottom; spare rows are blank lines above it, no blank after the inputs;
//  - compact draws no START, no inputs line and no entry (R16): the live compact layout, 37×7.
import type { Slot } from '@pitwall/domain';

export type Mode = 'full' | 'compact';
export type Variant = 'live' | 'planning';

/** The lead cell and the cell between two columns. */
export const LEAD = ' ';
export const GAP = ' ';

/** Column widths in cells; 0: the column is not drawn. */
export type Columns = { slot: number; start: number; stops: number; ePos: number; dPos: number; dTime: number; act: number };

const FULL_LIVE: Columns = { slot: 3, start: 0, stops: 23, ePos: 9, dPos: 6, dTime: 6, act: 8 };
const FULL_PLANNING: Columns = { slot: 3, start: 5, stops: 21, ePos: 9, dPos: 5, dTime: 5, act: 6 };
const COMPACT: Columns = { slot: 3, start: 0, stops: 15, ePos: 9, dPos: 6, dTime: 0, act: 0 };

/** The column widths of a variant in a mode. */
export function columnsOf(variant: Variant, mode: Mode): Columns {
  if (mode === 'compact') return COMPACT;
  return variant === 'planning' ? FULL_PLANNING : FULL_LIVE;
}

/** A line's width in cells; full with the places strip of `places` cells. */
export function widthOf(c: Columns, mode: Mode, places: number): number {
  const col = (w: number): number => (w > 0 ? GAP.length + w : 0);
  const lead = LEAD.length + c.slot + col(c.start) + col(c.stops) + col(c.ePos) + col(c.dPos);
  return mode === 'full' ? lead + col(c.dTime) + col(places) + col(c.act) : lead;
}

/** The planning round's inputs lines (SP4.3f Task 11, mockup round 2 `inputsLines`): what the user sets; what is imported or computed. */
export const INPUTS_LINES = 2;
/** The DP lines the planning round draws when they fit: one per stop count, 0 to 3. */
const DP_LINES = 4;

/**
 * The planning round's full lines besides the slot lines (SP4.3f Task 11): the two inputs lines, the header, the DP
 * rule, four DP lines and the last line (`save`, with a rejection when there is one); no blank after the inputs.
 */
export const PLANNING_FIXED = INPUTS_LINES + 1 + 1 + DP_LINES + 1;

/**
 * The DP lines that fit in `rows` with `slotLines` slot lines (saved, prefilled, entries), at most four: when the
 * planning lines exceed the rows, the DP lines are dropped first, bottom up (five slot lines at 13 rows: three).
 */
export const dpLinesFit = (slotLines: number, rows: number): number => Math.max(0, Math.min(DP_LINES, rows - (PLANNING_FIXED - DP_LINES) - slotLines));

/** The cells a rejection takes on the last line of a board `width` cells wide, before two gap cells and `save` (its label). */
export const beforeSave = (width: number, saveLabel: string): number => Math.max(1, width - LEAD.length - 2 * GAP.length - saveLabel.length);

/**
 * SP4.3f Task 7 (plan-board-conditions.html), Task 11: the conditions editor's full lines besides its rows and `+ row`,
 * in place of the plan rows: the two inputs lines, the header (with reset and done) and the last line (`save`).
 */
const CONDITIONS_FIXED = INPUTS_LINES + 1 + 1;

/** Whether `+ row` is offered: its line still fits in `rows` with `rowCount` conditions rows (and `save` below it). */
export const addRowFits = (rowCount: number, rows: number): boolean => CONDITIONS_FIXED + rowCount + 1 <= rows;

/** The conditions editor's cells (gen.mjs `conditionLines`): the offset (right-aligned), the weather and rain columns. */
export const CONDITIONS_COLS = { at: 4, weather: 14, rain: 16, rainField: 3 } as const;

/** The game slots: an empty one has its entry in the planning round (the game's plan typed in, mockup G2). */
export const GAME_SLOTS: readonly Slot[] = ['G1', 'G2'];
