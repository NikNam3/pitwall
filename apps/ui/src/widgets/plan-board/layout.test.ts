// The plan board's line budget in the planning round (SP4.3f Task 11; mockup round 2,
// docs/design/2026-11-18-sp4.3f/plan-board-conditions.html, gen.mjs `inputsLines`, `saveLine`, `boardWith`; C65, C68).
// Contract assumed of `layout.ts`:
//  - `PLANNING_FIXED` (exported): the planning round's full lines besides the slot lines: the two inputs lines (what the
//    user sets; what is imported or computed), the header, the DP rule, four DP lines and the last line (`save`, with a
//    rejection when there is one): 9;
//  - the planning round draws no blank after the inputs any more: `blankAfterInputs` is gone, or false at every size;
//  - `addRowFits(rowCount, rows)`: `+ row` is offered while its line fits with the two inputs lines, the header, the
//    rows and the last line (`save`): at 13 rows up to 8 rows, never with 9 (2 + 1 + 9 + save = 13).
// Fails until `PLANNING_FIXED` is exported (typecheck: no such export) and the budget counts the second inputs line.
import { describe, expect, it } from 'vitest';
import { fit } from './fixtures.ts';
import * as layout from './layout.ts';
import { addRowFits, PLANNING_FIXED } from './layout.ts';

/** The full minimum among the gallery's fit sizes (82×13). */
const FULL_MIN = Math.min(...fit.filter((s) => s.mode === 'full').map((s) => s.rows));
/** The planning round's slot lines in the gallery's `planningRound` case: A and B prefilled, G1 entered, G2's entry. */
const ROUND_SLOT_LINES = 4;

describe('plan board layout: the planning round (Task 11)', () => {
  it('the planning round\'s fixed lines: two inputs lines, header, DP rule, four DP lines, the last line = 9', () => {
    expect(PLANNING_FIXED).toBe(2 + 1 + 1 + 4 + 1);
  });

  it('the full minimum of the fit sizes holds the planning round\'s 13 lines', () => {
    expect(FULL_MIN).toBe(13);
    expect(PLANNING_FIXED + ROUND_SLOT_LINES).toBe(FULL_MIN);
  });

  it('no blank after the inputs: blankAfterInputs is gone or false at every size', () => {
    const blank = (layout as Record<string, unknown>)['blankAfterInputs'];
    if (blank === undefined) return;
    const f = blank as (slotLines: number, rows: number) => boolean;
    for (let slotLines = 0; slotLines <= 5; slotLines++) {
      for (let rows = 13; rows <= 30; rows++) expect(f(slotLines, rows), `${slotLines} slot lines, ${rows} rows`).toBe(false);
    }
  });

  it('+ row fits above save: at 13 rows with 8 rows, not with 9; with 9 at 14 rows', () => {
    expect(addRowFits(7, 13)).toBe(true);
    expect(addRowFits(8, 13)).toBe(true);
    expect(addRowFits(9, 13)).toBe(false);
    expect(addRowFits(9, 14)).toBe(true);
    expect(addRowFits(10, 14)).toBe(false);
  });
});
