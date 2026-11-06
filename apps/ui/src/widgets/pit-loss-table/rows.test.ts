// The pit-loss table's rows (spec 6; C65: the display formats and maps, it computes nothing). Contract assumed of `rows.ts`:
//  - `buildConditionRows(losses: PitLosses): ConditionRow[]`, one row per condition in the order green, VSC, SC, with
//    `{ condition, loss: CellPart, stat: CellPart, n: string, source: EstimateSource }`: the loss and the stationary
//    median as seconds to one decimal (kit `formatSeconds(ms, 1)`), or empty with the unknown's reason; N the session's
//    stops (kit `formatCount`); the source as the topic gives it (the calculator decided its kind, C43);
//  - `buildStopRows(input: { losses: PitLosses; cars: CarOverview[]; session: SessionInfo }): StopRow[]`, the session's
//    stops newest first (the topic gives them in lap order), with `{ carId, lap: string, code: CellPart, ours: boolean,
//    condition, loss: CellPart, stat: string, use }`: the lap as `L05` (kit `formatLapNumber(n, 2)`), the code from
//    cars.overview (kit `carCodeById`), ours from session.info (kit `ourCars`), loss and stationary time as seconds to one
//    decimal, `use` as the topic gives it.
import { describe, expect, it } from 'vitest';
import { carId, unknown } from '@pitwall/domain';
import {
  ANT, BEA, BOR, DOO, HAD, KUH, LAW, LIN, calibrationSource, cars, defaultSource, estimate, losses, mockupConditions, mockupStops,
  ms, sessionInfo, sessionSource, stop,
} from './fixtures.ts';
import { buildConditionRows, buildStopRows } from './rows.ts';

describe('buildConditionRows', () => {
  it('gives one row per condition in the order green, VSC, SC', () => {
    const { green, vsc, sc } = mockupConditions;
    // the record's key order is not the display's
    expect(buildConditionRows(losses({ sc, green, vsc })).map((r) => r.condition)).toEqual(['green', 'vsc', 'sc']);
  });

  it('formats the loss and the stationary median as seconds to one decimal, and N as the session stops', () => {
    expect(buildConditionRows(losses()).map((r) => [r.loss, r.stat, r.n])).toEqual([
      [{ text: '20.3' }, { text: '2.4' }, '6'],
      [{ text: '13.4' }, { text: '2.5' }, '0'],
      [{ text: '9.8' }, { text: '', reason: 'insufficientData' }, '0'],
    ]);
  });

  it('carries each source as the topic gives it: the calculator decided the kind, the table only shows it (C43)', () => {
    const rows = buildConditionRows(losses());
    expect(rows.map((r) => r.source)).toEqual([sessionSource(6), calibrationSource(), defaultSource]);
    expect(rows.map((r) => r.source.kind)).toEqual(['session', 'calibration', 'default']);
  });

  it('keeps a calibration source on a condition with session stops: it never decides the kind from N', () => {
    const conditions = { ...mockupConditions, green: estimate(20_300, 2_400, 6, calibrationSource('6 stops + league')) };
    expect(buildConditionRows(losses(conditions))[0]?.source.kind).toBe('calibration');
  });

  it('shows an unknown loss empty with its reason', () => {
    const conditions = { ...mockupConditions, vsc: { ...mockupConditions.vsc, lossMs: unknown('notApplicable') } };
    expect(buildConditionRows(losses(conditions))[1]?.loss).toEqual({ text: '', reason: 'notApplicable' });
  });

  it('does no arithmetic of its own: the values are the topic values, only rounded to the tenth', () => {
    const conditions = { ...mockupConditions, green: estimate(20_349, 2_351, 3, sessionSource(3)) };
    expect(buildConditionRows(losses(conditions))[0]).toMatchObject({ loss: { text: '20.3' }, stat: { text: '2.4' }, n: '3' });
  });
});

describe('buildStopRows', () => {
  const input = (stops = mockupStops) => ({ losses: losses(mockupConditions, stops), cars, session: sessionInfo() });

  it('lists the stops newest first: the reverse of the topic\'s lap order', () => {
    expect(buildStopRows(input()).map((r) => r.carId)).toEqual([BOR, ANT, BEA, LIN, LAW, DOO].map(carId));
    expect(buildStopRows(input()).map((r) => r.lap)).toEqual(['L19', 'L18', 'L16', 'L15', 'L14', 'L12']);
  });

  it('pads the lap to two digits', () => {
    expect(buildStopRows(input([stop(BOR, 5, 20_000, 2_400)])).map((r) => r.lap)).toEqual(['L05']);
  });

  it('takes the code from cars.overview; a car it lacks has an empty code with the reason (kit carCodeById)', () => {
    const rows = buildStopRows({ ...input(), cars: cars.filter((c) => c.id !== carId(BEA)) });
    expect(rows.map((r) => r.code.text)).toEqual(['BOR', 'ANT', '', 'LIN', 'LAW', 'DOO']);
    expect(rows[2]?.code.reason).toBe('notReceived');
  });

  it('marks our cars from session.info: the player car and the teammate', () => {
    const stops = [stop(KUH, 10, 20_000, 2_400), stop(LIN, 15, 20_000, 2_300), stop(BOR, 19, 20_600, 2_500)];
    expect(buildStopRows(input(stops)).map((r) => [r.code.text, r.ours])).toEqual([['BOR', false], ['LIN', true], ['KUH', true]]);
    expect(buildStopRows({ ...input(stops), session: sessionInfo(KUH, null) }).map((r) => r.ours)).toEqual([false, false, true]);
  });

  it('formats the loss and the stationary time as seconds to one decimal and carries the condition', () => {
    const stops = [stop(ANT, 30, 13_100, 2_400, 'used', 'vsc'), stop(BEA, 31, 9_600, 2_500, 'used', 'sc')];
    expect(buildStopRows(input(stops)).map((r) => [r.condition, r.loss, r.stat])).toEqual([
      ['sc', { text: '9.6' }, '2.5'],
      ['vsc', { text: '13.1' }, '2.4'],
    ]);
  });

  it('shows a stop without clean reference laps with an empty loss and its reason, and says it is not used', () => {
    const [row] = buildStopRows(input([stop(HAD, 21, undefined, 2_400, 'noReference')]));
    expect(row).toMatchObject({ loss: { text: '', reason: 'insufficientData' }, stat: '2.4', use: 'noReference' });
  });

  it('keeps a penalty stop\'s loss and says it is not used (R12)', () => {
    const [row] = buildStopRows(input([stop(KUH, 22, 25_700, 7_500, 'penalty')]));
    expect(row).toMatchObject({ loss: { text: '25.7' }, stat: '7.5', use: 'penalty' });
  });

  it('carries `used` for a counted stop', () => {
    expect(buildStopRows(input()).map((r) => r.use)).toEqual(['used', 'used', 'used', 'used', 'used', 'used']);
  });

  it('does no arithmetic of its own: the loss and the stationary time are the topic values as received', () => {
    // a stationary time far above the others is not corrected here: the calculator did that already
    const [row] = buildStopRows(input([{ ...stop(LAW, 14, 0, 9_100), lossMs: ms(31_240) }]));
    expect(row).toMatchObject({ loss: { text: '31.2' }, stat: '9.1' });
  });

  it('is empty without stops', () => {
    expect(buildStopRows(input([]))).toEqual([]);
  });
});
