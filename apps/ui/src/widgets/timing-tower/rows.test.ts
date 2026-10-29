import { describe, expect, it } from 'vitest';
import { carId, toSessionTime } from '@pitwall/domain';
import type { PitStopRecord, StintRecord } from '@pitwall/domain';
import { boardRow, incidentEntry, interval, lapBoard, ms, overview, sessionInfo, toCar } from './fixtures.ts';
import { buildRows, type TowerInput } from './rows.ts';

const base = (): TowerInput => ({
  cars: [
    overview(2, { name: 'Alex Albon', position: 3, gridPosition: 5 }),
    overview(0, { name: 'Max Verstappen', position: 1, gridPosition: 1 }),
    overview(1, { name: 'Kuh Driver', position: 2, gridPosition: 1, ours: true }),
  ],
  intervals: [interval(0), interval(1, 2184, 2184, 0, -1), interval(2, 5903, 3719, 0, 2)],
  toCar: [toCar(0, -2184), toCar(1, undefined), toCar(2, 3719)],
  board: lapBoard(1, [
    boardRow(0, 104_912, [28_104, 41_311, 35_497], ['sessionBest', 'none', 'none']),
    boardRow(1, 104_876, [28_150, 41_288, 35_438], ['none', 'personalBest', 'none'], 'personalBest'),
    boardRow(2, 105_208),
  ]),
  stints: [],
  pitStops: [],
  session: sessionInfo(1),
  incidents: undefined,
  showRetired: true,
});

const stint = (id: number, compound: StintRecord['visualCompound']): StintRecord => ({
  carId: carId(id), firstLap: 1, lastLap: 23, actualCompound: 'C3', visualCompound: compound, tyreAgeAtFitting: 0,
});
const stop = (id: number, lap: number): PitStopRecord => ({
  carId: carId(id), lap, pitLaneEntry: toSessionTime(1), pitLaneExit: toSessionTime(21), pitLaneTimeMs: 20_000,
  stationaryTimeMs: 2_300, flag: 'green', penaltyServed: false,
});
describe('buildRows', () => {
  it('orders the cars by position', () => {
    expect(buildRows(base()).map((r) => r.carId)).toEqual([0, 1, 2]);
  });

  it('marks the player car, and only it, by default', () => {
    expect(buildRows(base()).map((r) => r.ours)).toEqual([false, true, false]);
  });

  it('joins the gaps: gap to the leader, interval and TO US; our own row has no TO US', () => {
    const [vsr, us, alb] = buildRows(base());
    expect(vsr?.gapToLeader).toEqual({ known: false, reason: 'notApplicable' });
    expect(us?.gapToLeader).toEqual(ms(2184));
    expect(alb?.interval).toEqual(ms(3719));
    expect(vsr?.toUs).toEqual(ms(-2184));
    expect(alb?.toUs).toEqual(ms(3719));
    expect(us?.toUs).toBeUndefined();
  });

  it('joins the lap board: last lap, sectors and their statuses', () => {
    const [vsr, us] = buildRows(base());
    expect(vsr?.lastLap).toEqual(ms(104_912));
    expect(vsr?.sectors.map((s) => s.timeMs)).toEqual([ms(28_104), ms(41_311), ms(35_497)]);
    expect(vsr?.sectors.map((s) => s.status)).toEqual(['sessionBest', 'none', 'none']);
    expect(us?.lastLapStatus).toBe('personalBest');
    expect(us?.sectors[1]?.status).toBe('personalBest');
  });

  it('keeps a realism-hidden rival as unknown cells and still builds the row', () => {
    const input = base();
    input.board = lapBoard(1, [...input.board.rows.slice(0, 2), boardRow(2, 'realism')]);
    const alb = buildRows(input)[2];
    expect(alb?.lastLap).toEqual({ known: false, reason: 'realism' });
    expect(alb?.sectors.every((s) => !s.timeMs.known && s.status === 'none')).toBe(true);
  });

  it('shows unknown cells for a car missing from the gap and lap topics', () => {
    const input = base();
    input.intervals = [];
    input.toCar = [];
    input.board = lapBoard(1, []);
    const row = buildRows(input)[0];
    expect(row?.gapToLeader.known).toBe(false);
    expect(row?.toUs?.known).toBe(false);
    expect(row?.lastLap.known).toBe(false);
    expect(row?.lapsDown).toBe(0);
  });

  it('takes the position change from the gaps analysis (positionsGained), no arithmetic of its own', () => {
    expect(buildRows(base()).map((r) => r.change)).toEqual([0, -1, 2]);
  });

  it('has no change when positionsGained is unknown', () => {
    const input = base();
    input.intervals = [interval(0, undefined, undefined, 0, 'unknown'), ...input.intervals.slice(1)];
    expect(buildRows(input)[0]?.change).toBeUndefined();
    expect(buildRows(input)[1]?.change).toBe(-1);
  });

  it('has no change for a car without an interval entry', () => {
    const input = base();
    input.intervals = [];
    expect(buildRows(input)[0]?.change).toBeUndefined();
  });

  it('carries laps down from the intervals', () => {
    const input = base();
    input.intervals = [interval(0), interval(1, 2184, 2184), interval(2, 5903, 3719, 1)];
    expect(buildRows(input)[2]?.lapsDown).toBe(1);
  });

  it('takes compound and age from the overview; stops are the larger of the pit-stop records and the game count', () => {
    const input = base();
    input.cars = [overview(0, { name: 'Max Verstappen', position: 1, compound: 'hard', age: 23, numPitStops: 1 })];
    input.pitStops = [stop(0, 10), stop(0, 18), stop(1, 5)];
    const row = buildRows(input)[0];
    expect(row?.compound).toBe('hard');
    expect(row?.age).toBe(23);
    expect(row?.stops).toBe(2);
    input.pitStops = [];
    expect(buildRows(input)[0]?.stops).toBe(1);
  });

  it('falls back to the latest stint record when the overview compound is unknown', () => {
    const input = base();
    input.cars = [overview(0, { name: 'Max Verstappen', position: 1, compound: 'unknown' })];
    input.stints = [stint(0, 'soft'), stint(0, 'hard'), stint(1, 'medium')];
    expect(buildRows(input)[0]?.compound).toBe('hard');
  });

  it('carries the time penalty and warnings', () => {
    const input = base();
    input.cars = [overview(0, { name: 'Max Verstappen', position: 1, timePenaltyMs: 5000, totalWarnings: 2 })];
    const row = buildRows(input)[0];
    expect(row?.penaltyMs).toBe(5000);
    expect(row?.warnings).toBe(2);
  });

  it('reports the pit status: in the pits, or on an out lap', () => {
    const input = base();
    input.cars = [
      overview(0, { name: 'A', position: 1, pitStatus: 'pitting' }),
      overview(1, { name: 'B', position: 2, pitStatus: 'inPitArea' }),
      overview(2, { name: 'C', position: 3, driverStatus: 'outLap' }),
      overview(3, { name: 'D', position: 4 }),
    ];
    expect(buildRows(input).map((r) => r.pit)).toEqual(['pit', 'pit', 'out', undefined]);
  });

  it('marks our cars from session.info: the player car and the teammate', () => {
    const input = base();
    input.session = sessionInfo(1, 2);
    expect(buildRows(input).map((r) => r.ours)).toEqual([false, true, true]);
  });

  it('flags the cars of the newest major incident as involved', () => {
    const input = base();
    input.incidents = [incidentEntry('a', 'minor', [0]), incidentEntry('b', 'major', [2, 1]), incidentEntry('c', 'major', [0])];
    expect(buildRows(input).map((r) => r.involved)).toEqual([false, true, true]);
  });

  it('flags nobody without a major entry or without the incident feed', () => {
    const input = base();
    input.incidents = [incidentEntry('a', 'minor', [0])];
    expect(buildRows(input).some((r) => r.involved)).toBe(false);
    input.incidents = undefined;
    expect(buildRows(input).some((r) => r.involved)).toBe(false);
  });

  it('sinks a retired car below the running ones, without position or change, with its last lap', () => {
    const input = base();
    input.cars = [
      overview(3, { name: 'Esteban Ocon', position: 2, lap: 22, resultStatus: 'didNotFinish' }),
      ...base().cars,
    ];
    const rows = buildRows(input);
    expect(rows.map((r) => r.carId)).toEqual([0, 1, 2, 3]);
    const retired = rows[3];
    expect(retired?.retired).toBe(true);
    expect(retired?.position).toBeUndefined();
    expect(retired?.change).toBeUndefined();
    expect(retired?.retiredAtLap).toBe(22);
    expect(rows.slice(0, 3).every((r) => !r.retired && r.retiredAtLap === undefined)).toBe(true);
  });

  it('treats disqualified, not classified and retired as retired; finished stays running', () => {
    const input = base();
    input.cars = (['disqualified', 'notClassified', 'retired', 'finished'] as const).map((status, i) =>
      overview(i, { name: 'X', position: i + 1, resultStatus: status }));
    const rows = buildRows(input);
    expect(rows.map((r) => r.carId)).toEqual([3, 0, 1, 2]);
    expect(rows.map((r) => r.retired)).toEqual([false, true, true, true]);
  });

  it('drops unused car slots (invalid, inactive)', () => {
    const input = base();
    input.cars = [...base().cars, overview(5, { name: 'Z', position: 0, resultStatus: 'inactive' }), overview(6, { name: 'Y', position: 0, resultStatus: 'invalid' })];
    expect(buildRows(input).map((r) => r.carId)).toEqual([0, 1, 2]);
  });

  it('omits the retired cars when showRetired is off', () => {
    const input = base();
    input.cars = [...base().cars, overview(3, { name: 'Esteban Ocon', position: 4, resultStatus: 'retired' })];
    input.showRetired = false;
    expect(buildRows(input).map((r) => r.carId)).toEqual([0, 1, 2]);
  });
});
