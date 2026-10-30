import { describe, expect, it } from 'vitest';
import { known, OUT_OF_RACE_STATUSES, toSessionTime, unknown, type Known, type RaceMoment } from '@pitwall/domain';
import { formatPenaltyMs } from '../../kit/values/format.ts';
import { boardRow, incidentEntry, interval, lapBoard, ms, overview, sessionInfo, toCar } from './fixtures.ts';
import { buildRows, type TowerInput } from './rows.ts';

/** The incident moment naming entry `entryId`, as race-moment gives it. */
const incidentMoment = (entryId: string): Known<RaceMoment> =>
  known({ moment: 'incident', since: unknown('notApplicable'), cause: { rule: 'majorIncident', params: { entryId } }, active: ['incident'] }, toSessionTime(900));

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
  session: sessionInfo(1),
  incidents: undefined,
  showRetired: true,
});

describe('buildRows', () => {
  it('orders the cars by position', () => {
    expect(buildRows(base()).map((r) => r.carId)).toEqual([0, 1, 2]);
  });

  it('marks the player car, and only it, by default', () => {
    expect(buildRows(base()).map((r) => r.ours)).toEqual([false, true, false]);
  });

  it('joins the gaps: gap to the leader, interval and TO US as gaps.toCar gives them', () => {
    const [vsr, us, alb] = buildRows(base());
    expect(vsr?.gapToLeader).toEqual({ known: false, reason: 'notApplicable' });
    expect(us?.gapToLeader).toEqual(ms(2184));
    expect(alb?.interval).toEqual(ms(3719));
    expect(vsr?.toUs).toMatchObject({ gapMs: ms(-2184), lapsDown: 0 });
    expect(alb?.toUs).toMatchObject({ gapMs: ms(3719), lapsDown: 0 });
    // the car the topic is measured to: the analysis gives it notApplicable
    expect(us?.toUs.gapMs).toEqual(unknown('notApplicable'));
  });

  it('TO US follows the car the topic is measured to, not the player: with the teammate as primary the player row has its gap', () => {
    const input = base();
    input.session = sessionInfo(1, 2);
    input.toCar = [toCar(0, -5903), toCar(1, -3719), toCar(2, undefined)];
    const [, player, teammate] = buildRows(input);
    expect(player?.toUs.gapMs).toEqual(ms(-3719));
    expect(teammate?.toUs.gapMs).toEqual(unknown('notApplicable'));
  });

  it("TO US carries the laps from gaps.toCar, relative to that car, not the leader's laps down", () => {
    const input = base();
    // car 2 is a lap down on the leader but on the same lap as us; car 0 is a lap ahead of us
    input.intervals = [interval(0), interval(1, 2184, 2184, 1), interval(2, 5903, 3719, 1)];
    input.toCar = [toCar(0, -2184, -1), toCar(1, undefined), toCar(2, 3719)];
    const [vsr, , alb] = buildRows(input);
    expect(vsr?.toUs).toMatchObject({ lapsDown: -1 });
    expect(alb?.toUs).toMatchObject({ gapMs: ms(3719), lapsDown: 0 });
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
    expect(row?.toUs.gapMs.known).toBe(false);
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

  it('takes compound, age and the reconciled stops from the overview (not the game count)', () => {
    const input = base();
    input.cars = [overview(0, { name: 'Max Verstappen', position: 1, compound: 'hard', age: 23, numPitStops: 1, stops: 2 })];
    const row = buildRows(input)[0];
    expect(row?.compound).toBe('hard');
    expect(row?.age).toBe(23);
    expect(row?.stops).toBe(2);
  });

  it('carries the time penalty and warnings only as the PEN cell shows them (no raw fields beside it)', () => {
    const input = base();
    input.cars = [overview(0, { name: 'Max Verstappen', position: 1, timePenaltyMs: 5000, totalWarnings: 2 })];
    const row = buildRows(input)[0];
    expect(row?.penalty).toMatchObject({ text: '5s', role: 'warning' });
    expect(row).not.toHaveProperty('penaltyMs');
    expect(row).not.toHaveProperty('warnings');
  });

  describe('the PEN cell: an unserved stop-go, else a drive-through, else the time penalty (user, live test 2026-10-30)', () => {
    type Penalties = { timePenaltyMs?: number; totalWarnings?: number; unservedDriveThroughs?: number; unservedStopGos?: number };
    const pen = (p: Penalties) => {
      const input = base();
      input.cars = [overview(0, { name: 'Max Verstappen', position: 1, ...p })];
      return buildRows(input)[0]!.penalty;
    };

    it('an unserved stop-go shows SG, an unserved drive-through DT, both in the penalty role', () => {
      expect(pen({ unservedStopGos: 1 })).toMatchObject({ text: 'SG', role: 'warning' });
      expect(pen({ unservedDriveThroughs: 1 })).toMatchObject({ text: 'DT', role: 'warning' });
    });

    it('a stop-go comes before a drive-through', () => {
      expect(pen({ unservedStopGos: 1, unservedDriveThroughs: 1 })).toMatchObject({ text: 'SG', role: 'warning' });
    });

    it('a time penalty alone shows its time, as before', () => {
      expect(pen({ timePenaltyMs: 5000 })).toMatchObject({ text: '5s', role: 'warning' });
    });

    it('a time penalty beside a drive-through or stop-go goes to the title, in the time format of the cell', () => {
      const dt = pen({ timePenaltyMs: 5000, unservedDriveThroughs: 1 });
      expect(dt).toMatchObject({ text: 'DT', role: 'warning' });
      expect(dt.title).toContain(formatPenaltyMs(5000));
      const sg = pen({ timePenaltyMs: 10_000, unservedStopGos: 1 });
      expect(sg).toMatchObject({ text: 'SG', role: 'warning' });
      expect(sg.title).toContain(formatPenaltyMs(10_000));
    });

    it('more than one unserved stop-go or drive-through shows the count before the code, in the 3 cells of the column', () => {
      expect(pen({ unservedDriveThroughs: 2 })).toMatchObject({ text: '2DT', role: 'warning' });
      expect(pen({ unservedStopGos: 2 })).toMatchObject({ text: '2SG', role: 'warning' });
      expect(pen({ unservedStopGos: 3, unservedDriveThroughs: 1 })).toMatchObject({ text: '3SG', role: 'warning' });
      expect(pen({ unservedStopGos: 1, unservedDriveThroughs: 2 })).toMatchObject({ text: 'SG', role: 'warning' });
      expect(pen({ unservedDriveThroughs: 2, timePenaltyMs: 5000 }).title).toContain(formatPenaltyMs(5000));
    });

    it('no penalty: an empty neutral cell; warnings alone show their count, neutral, as before', () => {
      const none = pen({});
      expect(none.text).toBe('');
      expect(none.role).toBeUndefined();
      const warned = pen({ totalWarnings: 2 });
      expect(warned.text).toBe('2w');
      expect(warned.role).toBeUndefined();
    });
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

  it('flags the cars of the incident the incident moment names as involved, not the newest major one', () => {
    const input = base();
    input.incidents = [incidentEntry('a', 'minor', [0]), incidentEntry('b', 'major', [2, 1]), incidentEntry('c', 'major', [0])];
    input.moment = incidentMoment('c');
    expect(buildRows(input).map((r) => r.involved)).toEqual([true, false, false]);
    input.moment = incidentMoment('b');
    expect(buildRows(input).map((r) => r.involved)).toEqual([false, true, true]);
  });

  it('flags nobody outside the incident moment or without the incident feed', () => {
    const input = base();
    input.incidents = [incidentEntry('b', 'major', [2, 1])];
    expect(buildRows(input).some((r) => r.involved)).toBe(false);
    input.moment = incidentMoment('b');
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

  it("treats the domain's out-of-race statuses as retired; finished stays running", () => {
    const input = base();
    const statuses = [...OUT_OF_RACE_STATUSES, 'finished' as const];
    input.cars = statuses.map((status, i) => overview(i, { name: 'X', position: i + 1, resultStatus: status }));
    const rows = buildRows(input);
    const finished = statuses.length - 1;
    expect(rows.map((r) => r.carId)).toEqual([finished, ...statuses.slice(0, -1).map((_, i) => i)]);
    expect(rows.map((r) => r.retired)).toEqual([false, ...statuses.slice(0, -1).map(() => true)]);
  });

  // The analysis decides a retired car's TO US reason (review 2, F6): gaps.toCar gives it notApplicable, and the tower
  // shows the entry as it comes, with no rule of its own.
  it("shows a retired car's TO US as gaps.toCar gives it, and like any car the topic lacks without an entry", () => {
    const input = base();
    input.cars = [
      ...base().cars,
      overview(3, { name: 'Esteban Ocon', position: 4, lap: 22, resultStatus: 'retired' }),
      overview(4, { name: 'Pierre Gasly', position: 5, lap: 9, resultStatus: 'disqualified' }),
    ];
    input.toCar = [...base().toCar, toCar(3, undefined)];
    const rows = buildRows(input);
    expect(rows.find((r) => r.carId === 3)?.toUs).toEqual({ gapMs: unknown('notApplicable'), lapsDown: 0 });
    expect(rows.find((r) => r.carId === 4)?.toUs.gapMs).toEqual(unknown('notReceived'));
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
