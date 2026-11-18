// The plan board's cell budget (mockup docs/design/2026-11-16-sp4.3d/plan-board.html, gen.mjs `boardSpec`; SP4.3d2
// Task 12, run log R16): the column widths per variant and mode, and the lines of the planning round, so every variant
// fits the declared sizes (widget.ts: full 82×13, compact 37×7).
//  - width: the lead cell, SLOT, then per column its cells and one gap cell before it. Full live: SLOT 3, STOPS 23,
//    E[POS] 9, ΔPOS 6, ΔTIME 6, the places strip (20), the action 8: 82 cells. Full planning adds START (5, its header;
//    the compound letter left in it) and narrows the rest: STOPS 21 (three stops `L11 H · L23 H · L35 S`), ΔPOS 5,
//    ΔTIME 5, the action 6 (`accept`, `→ slot`): 82 cells. Compact (both variants): SLOT, STOPS 15, E[POS], ΔPOS: 37;
//  - lines, full planning: the inputs line, the header, one line per slot (a saved plan, a prefill or an empty game
//    slot's entry: five at most), the DP rule, four DP lines and the last line (the actions or the picker): 13 at most;
//    the blank after the inputs line (the mockup's) only while a line is to spare;
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

/** The planning round's full lines besides the slot lines: inputs, header, DP rule, four DP lines, the last line. */
const PLANNING_FIXED = 1 + 1 + 1 + 4 + 1;

/** Whether the blank after the inputs line fits in `rows` with `slotLines` slot lines (saved, prefilled, entries). */
export const blankAfterInputs = (slotLines: number, rows: number): boolean => PLANNING_FIXED + slotLines + 1 <= rows;

/**
 * SP4.3f Task 7 (plan-board-conditions.html): the conditions editor's full lines besides its rows, in place of the plan
 * rows: the inputs line, the header (with reset and done) and the `+ row` line.
 */
const CONDITIONS_FIXED = 1 + 1 + 1;

/** Whether `+ row` is offered: one more row still fits in `rows` with `rowCount` conditions rows. */
export const addRowFits = (rowCount: number, rows: number): boolean => CONDITIONS_FIXED + rowCount + 1 <= rows;

/** The conditions editor's cells (gen.mjs `conditionLines`): the offset (right-aligned), the weather and rain columns. */
export const CONDITIONS_COLS = { at: 4, weather: 14, rain: 16, rainField: 3 } as const;

/** The game slots: an empty one has its entry in the planning round (the game's plan typed in, mockup G2). */
export const GAME_SLOTS: readonly Slot[] = ['G1', 'G2'];
