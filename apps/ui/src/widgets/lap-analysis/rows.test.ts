import { describe, expect, it } from 'vitest';
import { carId, unknown } from '@pitwall/domain';
import { KUH, LEC, NOR, PIA, VER, boardRow, cars, lapBoard, ms, sessionBests, sessionInfo } from './fixtures.ts';
import { buildRows, cellOf, type LapAnalysisInput } from './rows.ts';

const base = (): LapAnalysisInput => ({
  board: lapBoard(1, [
    boardRow(4, PIA, KUH), boardRow(3, LEC, KUH), boardRow(1, KUH, KUH), boardRow(2, NOR, KUH), boardRow(0, VER, KUH),
  ], sessionBests),
  cars,
  session: sessionInfo(1),
});

describe('buildRows', () => {
  it('puts the reference car first, then the others by best lap, fastest first', () => {
    expect(buildRows(base()).map((r) => r.carId)).toEqual([1, 0, 2, 3, 4]);
  });

  it('marks the reference row, and only it', () => {
    expect(buildRows(base()).map((r) => r.reference)).toEqual([true, false, false, false, false]);
  });

  it('shows absolute times on the reference row and no deltas', () => {
    const ref = buildRows(base())[0]!;
    expect(ref.best).toMatchObject({ value: ms(KUH.best), absolute: true });
    expect(ref.sectors.map((s) => [s.value, s.absolute])).toEqual(KUH.sectors.map((t) => [ms(t), true]));
    expect(ref.theo).toMatchObject({ value: ms(KUH.theo), absolute: true });
  });

  it('shows the deltas to the reference on every other row', () => {
    const ver = buildRows(base())[1]!;
    expect(ver.best).toMatchObject({ value: ms(VER.best - KUH.best), absolute: false });
    expect(ver.sectors.map((s) => [s.value, s.absolute])).toEqual([[ms(-46), false], [ms(23), false], [ms(59), false]]);
    expect(ver.theo).toMatchObject({ value: ms(VER.theo - KUH.theo), absolute: false });
  });

  it('takes the code from cars.overview; a car it lacks has an empty code with the reason (kit carCodeById)', () => {
    const input = base();
    input.cars = cars.filter((c) => c.id !== carId(4));
    const rows = buildRows(input);
    expect(rows.map((r) => r.code.text)).toEqual(['KUH', 'VER', 'NOR', 'LEC', '']);
    expect(rows[4]!.code.reason).toBe('notReceived');
  });

  it('marks our cars from session.info: the player car and the teammate', () => {
    expect(buildRows(base()).map((r) => r.ours)).toEqual([true, false, false, false, false]);
    const input = base();
    input.session = sessionInfo(1, 3);
    expect(buildRows(input).map((r) => r.ours)).toEqual([true, false, false, true, false]);
  });

  it("takes each cell's status from the board: session bests where it says so, none elsewhere", () => {
    const rows = buildRows(base());
    const [ref, ver, , lec] = rows;
    expect(ver?.best.status).toBe('sessionBest');
    expect(ver?.sectors.map((s) => s.status)).toEqual(['sessionBest', 'none', 'none']);
    expect(ref?.best.status).toBe('none');
    expect(ref?.sectors.map((s) => s.status)).toEqual(['none', 'sessionBest', 'none']);
    expect(lec?.sectors[2]?.status).toBe('sessionBest');
  });

  it('decides no best itself: a status the board gives is carried as is, whatever the times', () => {
    const input = base();
    const nor = input.board.rows.find((r) => r.carId === carId(2))!;
    nor.bestLapStatus = 'sessionBest';
    nor.bestSectorStatus = ['none', 'none', 'sessionBest'];
    const row = buildRows(input).find((r) => r.carId === carId(2))!;
    expect(row.best.status).toBe('sessionBest');
    expect(row.sectors.map((s) => s.status)).toEqual(['none', 'none', 'sessionBest']);
  });

  it('never lights the theoretical best', () => {
    expect(buildRows(base()).map((r) => r.theo.status)).toEqual(['none', 'none', 'none', 'none', 'none']);
  });

  it('keeps a realism-hidden rival as unknown cells with the reason, and still builds the row', () => {
    const input = base();
    input.board = lapBoard(1, [boardRow(1, KUH, KUH), boardRow(2, 'realism', KUH)], sessionBests);
    const hidden = buildRows(input)[1]!;
    expect(hidden.best.value).toEqual(unknown('realism'));
    expect(hidden.sectors.every((s) => !s.value.known && s.status === 'none')).toBe(true);
    expect(hidden.theo.value).toEqual(unknown('realism'));
  });

  it('sorts cars without a best lap last, by car id', () => {
    const input = base();
    input.board = lapBoard(1, [boardRow(4, 'noTimes', KUH), boardRow(2, NOR, KUH), boardRow(1, KUH, KUH), boardRow(3, 'realism', KUH)], sessionBests);
    expect(buildRows(input).map((r) => r.carId)).toEqual([1, 2, 3, 4]);
  });

  it('still builds the reference row when the reference car is missing from the board', () => {
    const input = base();
    input.board = lapBoard(1, [boardRow(2, NOR, KUH)], sessionBests);
    expect(buildRows(input).map((r) => r.carId)).toEqual([2]);
  });

  it('does no arithmetic of its own: the cells are the board values as received', () => {
    const input = base();
    const row = input.board.rows.find((r) => r.carId === carId(0))!;
    row.deltaToReference.bestLapMs = ms(12_345);
    expect(buildRows(input)[1]?.best.value).toEqual(ms(12_345));
  });
});

describe('cellOf', () => {
  it('gives the cell of each time column and none for DRV', () => {
    const [ref] = buildRows(base());
    expect(cellOf(ref!, 'best')).toBe(ref!.best);
    expect(cellOf(ref!, 'theo')).toBe(ref!.theo);
    expect([cellOf(ref!, 's1'), cellOf(ref!, 's2'), cellOf(ref!, 's3')]).toEqual(ref!.sectors);
    expect(cellOf(ref!, 'drv')).toBeUndefined();
  });
});
