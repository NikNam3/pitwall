// The plan board's rows (SP4.3d spec §6.2, V17; mockup docs/design/2026-11-16-sp4.3d/plan-board.html; C65: the display
// formats and maps what `strategy` decided, it computes nothing; C68). Contract assumed of `rows.ts`:
//  - `boardRows(value: BoardTable, mode: 'full' | 'compact'): BoardView`, `BoardView` `{ slots: SlotLine[], dp: DpLine[],
//    scale: number, ourPlace: number }`:
//    - `slots`: one line per row with a `slot`, in `PLAN_SLOTS` order (A, B, C, G1, G2); an active row without a slot
//      (source `committed`) first, keyed `active`. Compact: the active line and the best-ranked other slot lines (the
//      topic's row order), three lines at most, still in slot order (gen.mjs `bCompact`: A●, B, G1);
//    - `dp`: one line per `bestPerStops` entry, by stop count (0, 1, 2, 3); compact only the 1- and 2-stop;
//    - `scale` the kit's `sharedScale` over the pmfs of every line in the view, so the strips compare; `ourPlace` the
//      topic's `currentPosition` (the strip's underline);
//  - `SlotLine` `{ key: Slot | 'active', slot: Slot | null, label, active, faint, hover, stops, ePos, dPos, dPosRole,
//    dTime, pmf, policy }`:
//    - `label` the slot, `●` after it on the active row (`A●`; `●` alone for the active row without a slot);
//    - `stops` `L22 H`, stops joined by ` · ` (`L18 H · L33 S`), laps two digits, compound letters; `no stop` without one;
//    - `ePos` E[pos] with the row's SE (`7.94±.06`, the kit's `formatExpectedPlaceSe`);
//    - `dPos` the row's `diffPlan` signed, two decimals (`+0.38`, `−1.02`), empty while unknown (the active row, no
//      active plan); `dPosRole` the warning role below −1 place, else `undefined`;
//    - `dTime` the row's `deltaPlanMs` signed seconds, one decimal (`−2.4`), empty on the active row or when `null`;
//    - `faint` and `hover` for an infeasible row: true and `text.infeasible[reason]`; else false and `undefined`;
//    - `pmf` and `policy` the row's own;
//  - `DpLine` `{ stopCount, stops, ePos, dPos, dPosRole, dTime, pmf, policy, same: Slot | null }`: the cells of the row
//    `bestPerStops` names, formatted as a slot line's; `same` that row's slot when it is one (the board shows `= A`).
// Needs `rows.ts` and `text.ts` (implementation): fails at typecheck until they exist.
import { known, PLAN_SLOTS, toSessionTime } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { sharedScale } from '../../kit/dist/dist.ts';
import { board, COLD, COMPACT, OUR_PLACE, RACE, SAME_AS_A } from './fixtures.ts';
import { boardRows } from './rows.ts';
import * as text from './text.ts';

const cellsOf = (l: { stops: string; ePos: string; dPos: string; dTime: string }) => [l.stops, l.ePos, l.dPos, l.dTime];

describe('plan board rows: race, full (the mockup\'s first figure)', () => {
  const view = boardRows(RACE, 'full');

  it('the slots in slot order, A active: label, STOPS, E[POS]±, ΔPOS, ΔTIME as the mockup prints them', () => {
    expect(view.slots.map((l) => [l.key, l.label, l.active])).toEqual([
      ['A', 'A●', true],
      ['B', 'B', false],
      ['C', 'C', false],
      ['G1', 'G1', false],
      ['G2', 'G2', false],
    ]);
    expect(view.slots.map(cellsOf)).toEqual([
      ['L22 H', '7.94±.06', '', ''],
      ['L18 H · L33 S', '7.56±.07', '+0.38', '−2.4'],
      ['L13 H · L30 H', '8.97±.08', '−1.02', '+4.2'],
      ['L20 H', '7.89±.06', '+0.05', '−0.5'],
      ['L17 S · L31 H', '8.16±.07', '−0.22', '+1.6'],
    ]);
  });

  it('the DP\'s best per stop count: no stop, 1, 2, 3 stops, each `→ slot` (no slot equal)', () => {
    expect(view.dp.map((l) => l.stopCount)).toEqual([0, 1, 2, 3]);
    expect(view.dp.map(cellsOf)).toEqual([
      ['no stop', '9.81±.08', '−1.87', '+12.2'],
      ['L21 H', '7.86±.06', '+0.08', '−0.6'],
      ['L20 H · L34 S', '7.65±.07', '+0.30', '−1.9'],
      ['L16 H · L27 H · L37 S', '8.29±.08', '−0.35', '+3.3'],
    ]);
    expect(view.dp.every((l) => l.same === null)).toBe(true);
    for (const l of view.dp) expect(l.policy, String(l.stopCount)).toEqual(RACE.rows[RACE.bestPerStops[l.stopCount]!]!.policy);
  });

  it('ΔPOS below −1 place is amber (C, no stop); every other ΔPOS has no role', () => {
    const roles = [...view.slots, ...view.dp].map((l) => [l.stops, l.dPosRole]);
    expect(roles.filter(([, r]) => r !== undefined)).toEqual([
      ['L13 H · L30 H', 'warning'],
      ['no stop', 'warning'],
    ]);
  });

  it('an infeasible slot is faint with its reason on hover (C: its stop lap passed)', () => {
    const c = view.slots.find((l) => l.key === 'C')!;
    expect([c.faint, c.hover]).toEqual([true, text.infeasible.stopLapPassed]);
    for (const l of view.slots.filter((x) => x.key !== 'C')) expect([l.faint, l.hover], String(l.key)).toEqual([false, undefined]);
  });

  it('each line carries its row\'s pmf and policy; one shared scale; our place now from the topic', () => {
    for (const l of view.slots) {
      const row = RACE.rows.find((r) => r.slot === l.slot)!;
      expect(l.pmf).toEqual(row.positionPmf);
      expect(l.policy).toEqual(row.policy);
    }
    expect(view.scale).toBe(sharedScale([...view.slots, ...view.dp].map((l) => l.pmf)));
    expect(view.ourPlace).toBe(OUR_PLACE);
  });
});

describe('plan board rows: other states', () => {
  it('compact: the active slot and the two best-ranked others in slot order (A●, B, G1); the DP\'s 1- and 2-stop', () => {
    const view = boardRows(RACE, 'compact');
    expect(view.slots.map((l) => l.label)).toEqual(['A●', 'B', 'G1']);
    expect(view.dp.map((l) => [l.stopCount, l.stops])).toEqual([
      [1, 'L21 H'],
      [2, 'L20 H · L34 S'],
    ]);
    expect(boardRows(COMPACT, 'compact').slots.map((l) => l.label)).toEqual(['A●', 'B', 'G1']);
  });

  it('a DP pick equal to a slot names it (`= A`) and shows that slot\'s cells', () => {
    const value = board({ dp: SAME_AS_A });
    const view = boardRows(value, 'full');
    const one = view.dp.find((l) => l.stopCount === 1)!;
    expect(one.same).toBe('A');
    expect(cellsOf(one)).toEqual(cellsOf(view.slots.find((l) => l.key === 'A')!));
    expect(view.dp.filter((l) => l.stopCount !== 1).every((l) => l.same === null)).toBe(true);
  });

  it('cold start: the wider SE (×3)', () => {
    const view = boardRows(COLD, 'full');
    expect(view.slots.map((l) => [l.label, l.ePos])).toEqual([
      ['A●', '7.94±.18'],
      ['B', '7.56±.21'],
    ]);
    expect(view.dp.map((l) => l.ePos)).toEqual(['7.86±.18', '7.65±.21']);
  });

  it('no active plan: no ●, every ΔPOS and ΔTIME empty', () => {
    const view = boardRows(board({ active: null }), 'full');
    expect(view.slots.map((l) => l.label)).toEqual([...PLAN_SLOTS]);
    expect(view.slots.every((l) => !l.active)).toBe(true);
    for (const l of [...view.slots, ...view.dp]) expect([l.dPos, l.dTime], l.stops).toEqual(['', '']);
  });

  it('an active plan in no slot (source committed) is the first line, `●`, keyed active', () => {
    const value = board();
    const k = value.rows.findIndex((r) => r.committed);
    const rows = value.rows.map((r, i) => (i === k ? { ...r, slot: null, source: 'committed' as const } : r));
    const view = boardRows({ ...value, rows }, 'full');
    expect(view.slots.map((l) => [l.key, l.label, l.slot])).toEqual([
      ['active', '●', null],
      ['B', 'B', 'B'],
      ['C', 'C', 'C'],
      ['G1', 'G1', 'G1'],
      ['G2', 'G2', 'G2'],
    ]);
    expect(view.slots[0]!.stops).toBe('L22 H');
  });

  it('a slot whose set is gone is faint with its reason (noSetLeft)', () => {
    const value = board();
    const rows = value.rows.map((r) => (r.slot === 'G2' ? { ...r, infeasible: 'noSetLeft' as const } : r));
    const g2 = boardRows({ ...value, rows }, 'full').slots.find((l) => l.key === 'G2')!;
    expect([g2.faint, g2.hover]).toEqual([true, text.infeasible.noSetLeft]);
  });

  it('ΔPOS is the topic\'s own diffPlan (R31), not recomputed from E[pos]', () => {
    const value = board();
    const rows = value.rows.map((r) => (r.slot === 'B' ? { ...r, diffPlan: known(1.234, toSessionTime(0)) } : r));
    expect(boardRows({ ...value, rows }, 'full').slots.find((l) => l.key === 'B')!.dPos).toBe('+1.23');
  });
});
