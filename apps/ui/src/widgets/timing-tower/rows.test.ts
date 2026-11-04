// The tower's rows (C54, C65, C66): one row per car in the session, joined from the topics it declares. Where a car is,
// what it does, what it owes and whether it still competes come from the situation topics (`situation.<machine>`, open
// spans only), never from a signal field (Task 24 removes them, C13); each kind maps to its cell through `presentation.ts`.
//  - Unused and retired rows: `car-status` (`absent` and a car without a status span are not shown; `retired` and
//    `disqualified` sink below the running cars).
//  - The situation column: GARAGE, PIT, BOX, DT, SG, OUT, IN, RET, FIN (empty on a racing, flying or push lap), from
//    `car-location`, `car-status` and the car-activity machine of the session's weekend phase (`weekend-phase`).
//  - The PEN cell: `penalties` (race only) and `warnings`.
import { describe, expect, it } from 'vitest';
import { known, toSessionTime, unknown, type Known, type RaceMoment } from '@pitwall/domain';
import { formatPenaltyMs } from '../../kit/values/format.ts';
import {
  boardRow, incidentEntry, interval, lapBoard, ms, outOfRaceRow, overview, pendingPenalty, servingPenalty, sessionInfo, situations,
  timePenalty, toCar, type CarSituation, type PhaseKind,
} from './fixtures.ts';
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
  ...situations([0, 1, 2]),
  showRetired: true,
});

/** `base()` with the cars' situations replaced: car 0 as `of[0]` gives it, and so on, in weekend phase `phase`. */
const withSituations = (of: Readonly<Record<number, CarSituation>>, phase: PhaseKind = 'race', ids: readonly number[] = [0, 1, 2]): TowerInput => ({
  ...base(),
  ...situations(ids, of, phase),
});

/** Car 0's row (the leader) with car 0 in situation `s`, in weekend phase `phase`. */
const leader = (s: CarSituation, phase: PhaseKind = 'race') => buildRows(withSituations({ 0: s }, phase)).find((r) => r.carId === 0)!;

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

  it('takes compound, age and the reconciled stops from the overview', () => {
    const input = base();
    input.cars = [overview(0, { name: 'Max Verstappen', position: 1, compound: 'hard', age: 23, stops: 2 })];
    const row = buildRows(input)[0];
    expect(row?.compound).toBe('hard');
    expect(row?.age).toBe(23);
    expect(row?.stops).toBe(2);
  });

  it('carries the time penalty and warnings only as the PEN cell shows them (no raw fields beside it)', () => {
    const row = leader({ penalty: timePenalty(5000), warnings: 2 });
    expect(row.penalty).toMatchObject({ text: '5s', role: 'warning' });
    expect(row).not.toHaveProperty('penaltyMs');
    expect(row).not.toHaveProperty('warnings');
  });

  // The PEN cell from the `penalties` span (race only) and the `warnings` span: the span's kind names what the car owes
  // (the machine decides which penalty comes first, C43); its detail gives the counts and the time beside it.
  describe('the PEN cell: the penalties span, else the warnings span', () => {
    const pen = (s: CarSituation, phase: PhaseKind = 'race') => leader(s, phase).penalty;

    it('clear and no warning: an empty neutral cell', () => {
      const none = pen({});
      expect(none.text).toBe('');
      expect(none.role).toBeUndefined();
    });

    it('a warned car without a penalty shows its warning count, neutral', () => {
      const warned = pen({ warnings: 2 });
      expect(warned.text).toBe('2w');
      expect(warned.role).toBeUndefined();
    });

    it('timePenalty shows its total, in the penalty role', () => {
      expect(pen({ penalty: timePenalty(5000) })).toMatchObject({ text: '5s', role: 'warning' });
      expect(pen({ penalty: timePenalty(10_000), warnings: 1 })).toMatchObject({ text: '10s', role: 'warning' });
    });

    it('driveThroughPending shows DT, stopGoPending SG, both in the penalty role', () => {
      expect(pen({ penalty: pendingPenalty('driveThroughPending', { driveThroughs: 1 }) })).toMatchObject({ text: 'DT', role: 'warning' });
      expect(pen({ penalty: pendingPenalty('stopGoPending', { stopGos: 1 }) })).toMatchObject({ text: 'SG', role: 'warning' });
    });

    it('owing both, the cell names the penalty the span names, not a precedence of its own', () => {
      expect(pen({ penalty: pendingPenalty('driveThroughPending', { driveThroughs: 1, stopGos: 1 }) })).toMatchObject({ text: 'DT', role: 'warning' });
      expect(pen({ penalty: pendingPenalty('stopGoPending', { driveThroughs: 1, stopGos: 1 }) })).toMatchObject({ text: 'SG', role: 'warning' });
    });

    it('more than one of the named kind shows the count before the code, in the 3 cells of the column', () => {
      expect(pen({ penalty: pendingPenalty('driveThroughPending', { driveThroughs: 2 }) })).toMatchObject({ text: '2DT', role: 'warning' });
      expect(pen({ penalty: pendingPenalty('stopGoPending', { stopGos: 2 }) })).toMatchObject({ text: '2SG', role: 'warning' });
      expect(pen({ penalty: pendingPenalty('stopGoPending', { stopGos: 3, driveThroughs: 1 }) })).toMatchObject({ text: '3SG', role: 'warning' });
    });

    it('a time penalty beside a drive-through or stop-go goes to the title, in the time format of the cell', () => {
      const dt = pen({ penalty: pendingPenalty('driveThroughPending', { driveThroughs: 1, totalMs: 5000 }) });
      expect(dt).toMatchObject({ text: 'DT', role: 'warning' });
      expect(dt.title).toContain(formatPenaltyMs(5000));
      const sg = pen({ penalty: pendingPenalty('stopGoPending', { stopGos: 1, totalMs: 10_000 }) });
      expect(sg).toMatchObject({ text: 'SG', role: 'warning' });
      expect(sg.title).toContain(formatPenaltyMs(10_000));
      expect(pen({ penalty: pendingPenalty('driveThroughPending', { driveThroughs: 2, totalMs: 5000 }) }).title).toContain(formatPenaltyMs(5000));
    });

    it('a penalty to serve outranks the warnings', () => {
      expect(pen({ penalty: pendingPenalty('driveThroughPending', { driveThroughs: 1 }), warnings: 3 }).text).toBe('DT');
    });

    it('outside the race (no penalties topic) the cell shows the warnings alone', () => {
      expect(pen({ warnings: 1 }, 'qualifying')).toMatchObject({ text: '1w' });
      expect(pen({}, 'practice').text).toBe('');
    });

    it('a car without a penalties or warnings span shows an empty cell', () => {
      expect(pen({ penalty: null, warnings: null }).text).toBe('');
    });
  });

  // One row per situation kind the tower shows (Task 25): the situation column from car-location, car-status and the
  // weekend phase's car-activity machine.
  describe('the situation column', () => {
    const code = (s: CarSituation, phase: PhaseKind = 'race') => leader(s, phase).situation.text;

    describe('race (car-activity-race)', () => {
      it('racingLap on track: empty', () => {
        expect(code({ location: 'track', activity: 'racingLap' })).toBe('');
      });

      it('inLap on track: IN', () => {
        expect(code({ location: 'track', activity: 'inLap' })).toBe('IN');
      });

      it('inLap in the pit lane: PIT', () => {
        expect(code({ location: 'pitLane', activity: 'inLap' })).toBe('PIT');
      });

      it('boxStop: BOX', () => {
        expect(code({ location: 'pitLane', activity: 'boxStop' })).toBe('BOX');
      });

      it('servingPenalty: DT for a drive-through, SG for a stop-go, in the penalty role', () => {
        expect(leader({ location: 'pitLane', activity: servingPenalty(0, 'driveThrough') }).situation).toMatchObject({ text: 'DT', role: 'warning' });
        expect(leader({ location: 'pitLane', activity: servingPenalty(0, 'stopGo') }).situation).toMatchObject({ text: 'SG', role: 'warning' });
      });

      it('outLap in the pit lane: PIT; on track: OUT', () => {
        expect(code({ location: 'pitLane', activity: 'outLap' })).toBe('PIT');
        expect(code({ location: 'track', activity: 'outLap' })).toBe('OUT');
      });

      it('finished: FIN', () => {
        expect(code({ location: 'track', activity: 'finished' })).toBe('FIN');
      });

      it('coolDown: FIN, on track and in the pit lane', () => {
        expect(code({ location: 'track', activity: 'coolDown' })).toBe('FIN');
        expect(code({ location: 'pitLane', activity: 'coolDown' })).toBe('FIN');
      });

      it('before the lights out (no activity span) the location alone: GARAGE, PIT, or empty on track', () => {
        expect(code({ location: 'garage', activity: null })).toBe('GARAGE');
        expect(code({ location: 'pitLane', activity: null })).toBe('PIT');
        expect(code({ location: 'track', activity: null })).toBe('');
      });

      it('the codes besides DT and SG carry no penalty role', () => {
        for (const s of [{ activity: 'inLap' }, { location: 'pitLane', activity: 'boxStop' }, { activity: 'outLap' }, { location: 'garage', activity: null }] as const) {
          expect(leader(s).situation.role).toBeUndefined();
        }
      });
    });

    describe('qualifying (car-activity-qualifying)', () => {
      it('pushLap: empty', () => {
        expect(code({ activity: 'pushLap' }, 'qualifying')).toBe('');
      });

      it('outLap on track: OUT; in the pit lane: PIT', () => {
        expect(code({ activity: 'outLap' }, 'qualifying')).toBe('OUT');
        expect(code({ location: 'pitLane', activity: 'outLap' }, 'qualifying')).toBe('PIT');
      });

      it('inLap on track: IN', () => {
        expect(code({ activity: 'inLap' }, 'qualifying')).toBe('IN');
      });

      it('garage: GARAGE', () => {
        expect(code({ location: 'garage', activity: 'garage' }, 'qualifying')).toBe('GARAGE');
      });

      it('finished: FIN', () => {
        expect(code({ activity: 'finished' }, 'qualifying')).toBe('FIN');
      });
    });

    describe('practice (car-activity-practice)', () => {
      it('flyingLap: empty', () => {
        expect(code({ activity: 'flyingLap' }, 'practice')).toBe('');
      });

      it('outLap on track: OUT', () => {
        expect(code({ activity: 'outLap' }, 'practice')).toBe('OUT');
      });

      it('inLap on track: IN', () => {
        expect(code({ activity: 'inLap' }, 'practice')).toBe('IN');
      });

      it('garage: GARAGE', () => {
        expect(code({ location: 'garage', activity: 'garage' }, 'practice')).toBe('GARAGE');
      });

      it('finished: FIN', () => {
        expect(code({ activity: 'finished' }, 'practice')).toBe('FIN');
      });
    });

    it('reads the car-activity machine of the weekend phase, never another phase\'s', () => {
      // a stale race activity beside a qualifying session: the qualifying activity decides
      const input = { ...withSituations({ 0: { activity: 'outLap' } }, 'qualifying'), raceActivity: situations([0, 1, 2], { 0: { activity: 'boxStop' } }).raceActivity };
      expect(buildRows(input).find((r) => r.carId === 0)?.situation.text).toBe('OUT');
    });

    it('with the weekend phase pending or none (no activity machine runs), the location alone', () => {
      expect(code({ location: 'garage' }, 'pending')).toBe('GARAGE');
      expect(code({ location: 'pitLane' }, 'none')).toBe('PIT');
      expect(code({ location: 'track' }, 'none')).toBe('');
    });

    it('car-status retired: RET', () => {
      expect(code({ status: 'retired', activity: 'notCompeting', location: 'garage' })).toBe('RET');
    });

    it('car-status disqualified: DSQ', () => {
      expect(code({ status: 'disqualified', activity: 'notCompeting' })).toBe('DSQ');
    });

    it('notCompeting with the car competing again shows the location alone', () => {
      expect(code({ status: 'competing', activity: 'notCompeting', location: 'track' })).toBe('');
    });

    it('carries no pit status field of its own', () => {
      expect(leader({})).not.toHaveProperty('pit');
    });
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

  // Retired and unused rows come from car-status (C43: the machine decides whether a car still competes); the tower
  // reads neither the lap board's out-of-race answer nor any result status for them.
  describe('retired and unused rows from car-status', () => {
    const four = (status: CarSituation): TowerInput => {
      const input = withSituations({ 3: status }, 'race', [0, 1, 2, 3]);
      input.cars = [overview(3, { name: 'Esteban Ocon', position: 2, lap: 22 }), ...base().cars];
      input.board = lapBoard(1, [...base().board.rows, boardRow(3, 'retired')]);
      return input;
    };

    it('sinks a retired car below the running ones, without position or change, with its last lap', () => {
      const rows = buildRows(four({ status: 'retired', activity: 'notCompeting' }));
      expect(rows.map((r) => r.carId)).toEqual([0, 1, 2, 3]);
      const retired = rows[3];
      expect(retired?.retired).toBe(true);
      expect(retired?.position).toBeUndefined();
      expect(retired?.change).toBeUndefined();
      expect(retired?.retiredAtLap).toBe(22);
      expect(rows.slice(0, 3).every((r) => !r.retired && r.retiredAtLap === undefined)).toBe(true);
    });

    it('a disqualified car sinks like a retired one', () => {
      const rows = buildRows(four({ status: 'disqualified', activity: 'notCompeting' }));
      expect(rows.map((r) => [r.carId, r.retired])).toEqual([[0, false], [1, false], [2, false], [3, true]]);
    });

    it('a competing car is running, whatever the lap board says', () => {
      const input = base();
      input.board = lapBoard(1, [...base().board.rows.filter((r) => r.carId !== 2), outOfRaceRow(boardRow(2, 105_208))]);
      const rows = buildRows(input);
      expect(rows.map((r) => [r.carId, r.retired, r.position])).toEqual([[0, false, 1], [1, false, 2], [2, false, 3]]);
    });

    it('a retired car is retired, whatever the lap board says', () => {
      const input = withSituations({ 2: { status: 'retired', activity: 'notCompeting' } });
      const row = buildRows(input).find((r) => r.carId === 2);
      expect(row?.retired).toBe(true);
      expect(row?.position).toBeUndefined();
      expect(row?.lastLap).toEqual(ms(105_208));
    });

    it('a finished car stays running, with FIN', () => {
      const rows = buildRows(withSituations({ 0: { activity: 'finished' } }));
      expect(rows.map((r) => r.retired)).toEqual([false, false, false]);
      expect(rows[0]?.situation.text).toBe('FIN');
    });

    it('drops an absent car (an unused slot)', () => {
      const input = withSituations({ 5: { status: 'absent' }, 6: { status: 'absent' } }, 'race', [0, 1, 2, 5, 6]);
      input.cars = [...base().cars, overview(5, { name: 'Z', position: 0 }), overview(6, { name: 'Y', position: 0 })];
      expect(buildRows(input).map((r) => r.carId)).toEqual([0, 1, 2]);
    });

    it('drops a car without a car-status span: nothing says it is in the session', () => {
      const input = withSituations({ 2: { status: null } });
      expect(buildRows(input).map((r) => r.carId)).toEqual([0, 1]);
    });

    it('omits the retired cars when showRetired is off', () => {
      const input = four({ status: 'retired', activity: 'notCompeting' });
      input.showRetired = false;
      expect(buildRows(input).map((r) => r.carId)).toEqual([0, 1, 2]);
    });
  });

  // The analysis decides a retired car's TO US reason (review 2, F6): gaps.toCar gives it notApplicable, and the tower
  // shows the entry as it comes, with no rule of its own.
  it("shows a retired car's TO US as gaps.toCar gives it, and like any car the topic lacks without an entry", () => {
    const input = withSituations({ 3: { status: 'retired', activity: 'notCompeting' }, 4: { status: 'disqualified', activity: 'notCompeting' } }, 'race', [0, 1, 2, 3, 4]);
    input.cars = [
      ...base().cars,
      overview(3, { name: 'Esteban Ocon', position: 4, lap: 22 }),
      overview(4, { name: 'Pierre Gasly', position: 5, lap: 9 }),
    ];
    input.toCar = [...base().toCar, toCar(3, undefined)];
    input.board = lapBoard(1, [...base().board.rows, boardRow(3, 'retired'), boardRow(4, 'retired')]);
    const rows = buildRows(input);
    expect(rows.find((r) => r.carId === 3)?.toUs).toEqual({ gapMs: unknown('notApplicable'), lapsDown: 0 });
    expect(rows.find((r) => r.carId === 4)?.toUs.gapMs).toEqual(unknown('notReceived'));
  });
});
