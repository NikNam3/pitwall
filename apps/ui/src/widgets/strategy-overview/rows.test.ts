// The Field plans rows (SP4.3d spec §6.4, V06; mockup docs/design/2026-11-16-sp4.3d/strategy-overview.html and README
// "What is drawn"; C65: the display formats and picks, it computes nothing; C68: numbers through the kit, wording in
// text.ts). Contract assumed of `rows.ts`:
//  - `fieldRows(input: { overview: StrategyOverview; cars: readonly CarOverview[]; now: number }): FieldRow[]`, one per
//    topic row in topic (race) order;
//  - `FieldRow = { carId: CarId; kind: 'own' | 'mate' | 'rival'; code: CellPart; pos: string; gap: CellPart;
//    tyre: CellPart; owes: boolean; next: CellPart; nextHover: string | undefined; window: CellPart }`:
//    - `kind`: `own` the overview's `carId`, `mate` any other row with a `plan` (our teammate), else `rival`;
//    - `code` the kit `carCodeById(cars, carId)`; `pos` the kit `formatPosition(position)`;
//    - `gap` the kit `formatSignedSeconds(gapMs, 1)` (`−15.2`, `+1.4`); the own row's gap is empty without a reason;
//      another unknown gap is the kit's unknown part (its reason's mark);
//    - `tyre` the compound's kit `COMPOUND_MARK` letter, a space and `tyreAge` (`M 14`); an unknown one the unknown part;
//    - `owes` true only while `owesCompound` is known and true (the `²`);
//    - `next`: a rival's likeliest next compound and its chance in whole percent without the sign (`H80`: the letter of
//      the largest chance in `nextCompound`); our rows empty; `nextHover` a rival's every odd (`H 80%`, `S 20%`, the kit
//      `formatShare`) and its window (`L16`, `L20`, likeliest `L18`; wording in text.ts), undefined on our rows and while
//      the window or the odds are unknown;
//    - `window` (compact): a rival's window `L16–20` (kit `formatLapRange(lowLap, highLap)`); our rows `A L22` (plan A's
//      first stop after `now`, kit `formatLapNumber(lap, 2)`), empty without one;
//    - a `notApplicable` window or odds (the car has made its stops: ALO) is empty without a mark, as the mockup draws
//      it; any other unknown reason is the kit's unknown part.
import { describe, expect, it } from 'vitest';
import type { StrategyOverview } from '@pitwall/domain';
import { EARLY, EARLY_LAP, FIELD, FOR_LIN, KUH, LIN, NOW_LAP, OURS_ONLY, OVERVIEW, ROWS, fieldAt, policy } from './fixtures.ts';
import { fieldRows } from './rows.ts';

type Part = { text: string; reason?: string };
type Row = {
  carId: number; kind: string; code: Part; pos: string; gap: Part; tyre: Part; owes: boolean; next: Part; nextHover: string | undefined; window: Part;
};
const rows = (overview: StrategyOverview, now = NOW_LAP, cars = FIELD): Row[] => fieldRows({ overview, cars, now });
const col = (rs: Row[], pick: (r: Row) => Part | string | boolean): unknown[] => rs.map((r) => {
  const v = pick(r);
  return typeof v === 'object' ? v.text : v;
});

describe('fieldRows: the mockup at L14/44 around KUH', () => {
  const rs = rows(OVERVIEW);

  it('one row per car in race order, with the codes from the names', () => {
    expect(col(rs, (r) => r.code)).toEqual(['ALO', 'NOR', 'PIA', 'KUH', 'RUS', 'SAI', 'LIN', 'GAS', 'OCO']);
    expect(col(rs, (r) => r.pos)).toEqual(['P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13']);
  });

  it('KUH is our row, LIN the teammate, the others rivals', () => {
    expect(col(rs, (r) => r.kind)).toEqual(['rival', 'rival', 'rival', 'own', 'rival', 'rival', 'mate', 'rival', 'rival']);
  });

  it('GAP signed to a tenth against KUH (+ = behind), our own gap empty without a mark', () => {
    expect(col(rs, (r) => r.gap)).toEqual(['−15.2', '−9.8', '−3.1', '', '+1.4', '+6.0', '+9.5', '+14.2', '+20.9']);
    expect(rs[3]!.gap.reason).toBeUndefined();
  });

  it('TYRE the compound letter and its laps', () => {
    expect(col(rs, (r) => r.tyre)).toEqual(['H 2', 'M 14', 'M 14', 'M 14', 'M 14', 'H 14', 'M 14', 'S 14', 'M 14']);
  });

  it('² on every rival that still owes its second dry compound, not on ALO nor our rows', () => {
    expect(col(rs, (r) => r.owes)).toEqual([false, true, true, false, true, true, false, true, true]);
  });

  it('NEXT the likeliest compound and its chance; ALO (stopped) and our rows empty', () => {
    expect(col(rs, (r) => r.next)).toEqual(['', 'H80', 'H70', '', 'H90', 'M60', '', 'H85', 'H75']);
    expect(rs[0]!.next.reason).toBeUndefined();
  });

  it('NEXT\'s hover: every odd and the window with its likeliest lap', () => {
    const nor = rs[1]!.nextHover ?? '';
    for (const t of ['H 80%', 'S 20%', 'L16', 'L20', 'L18']) expect(nor).toContain(t);
    expect(rs[3]!.nextHover).toBeUndefined();
    expect(rs[0]!.nextHover).toBeUndefined();
  });

  it('compact WINDOW: a rival\'s laps, our rows plan A\'s next stop, ALO empty', () => {
    expect(col(rs, (r) => r.window)).toEqual(['', 'L16–20', 'L18–23', 'A L22', 'L19–24', 'L24–30', 'A L21', 'L13–17', 'L20–26']);
    expect(rs[0]!.window.reason).toBeUndefined();
  });
});

describe('fieldRows: the other states', () => {
  it('LIN\'s panel: LIN own, KUH the teammate', () => {
    const rs = rows(FOR_LIN);
    expect(rs.find((r) => r.carId === LIN)!.kind).toBe('own');
    expect(rs.find((r) => r.carId === KUH)!.kind).toBe('mate');
    expect(rs.find((r) => r.carId === LIN)!.gap).toEqual({ text: '' });
    expect(rs.find((r) => r.carId === KUH)!.gap.text).toBe('−9.5');
  });

  it('the teammate\'s unknown gap is the kit\'s unknown part', () => {
    const lin = rows(OURS_ONLY).find((r) => r.carId === LIN)!;
    expect(lin.gap).toEqual({ text: '', reason: 'insufficientData' });
  });

  it('L02, too few laps: a rival\'s NEXT and WINDOW the unknown part, no ², no hover; KUH without a plan: WINDOW empty', () => {
    const rs = rows(EARLY, EARLY_LAP, fieldAt(EARLY_LAP));
    const nor = rs[0]!;
    expect(nor.next).toEqual({ text: '', reason: 'insufficientData' });
    expect(nor.window).toEqual({ text: '', reason: 'insufficientData' });
    expect(nor.owes).toBe(false);
    expect(nor.nextHover).toBeUndefined();
    expect(rs[1]!.window).toEqual({ text: '' });
  });

  it('our compact WINDOW names plan A\'s first stop after now, empty once every stop is behind', () => {
    const two: StrategyOverview = { ...OVERVIEW, rows: [{ ...ROWS.KUH, plan: { a: policy([10, 'hard'], [30, 'soft']), b: null } }] };
    expect(rows(two)[0]!.window.text).toBe('A L30');
    const done: StrategyOverview = { ...OVERVIEW, rows: [{ ...ROWS.KUH, plan: { a: policy([10, 'hard']), b: null } }] };
    expect(rows(done)[0]!.window).toEqual({ text: '' });
  });

  it('a car cars.overview does not list: its code is the unknown part', () => {
    const rs = rows(OVERVIEW, NOW_LAP, FIELD.filter((c) => c.id !== ROWS.OCO.carId));
    expect(rs.at(-1)!.code).toEqual({ text: '', reason: 'notReceived' });
  });
});

describe('rows.ts computes nothing (C65; review finding 1)', () => {
  it('NEXT\'s whole percent comes from the kit\'s formatShareNumber: no `* 100` in rows.ts', () => {
    const src = Object.values(import.meta.glob<string>('./rows.ts', { query: '?raw', import: 'default', eager: true }))[0]!;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\*\s*100\b/);
    expect(code).toMatch(/\bformatShareNumber\b/);
  });
});
