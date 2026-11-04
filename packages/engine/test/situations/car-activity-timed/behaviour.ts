// The behaviour the qualifying and the practice car-activity sub-machines share (contract C3, C9, C14, C15, C17, C18,
// C19, C26, C85), registered by each machine's test file for its machine: the machine stepped on its own through the
// inputs of `inputs.ts`. The rules are in `rows.ts`; these tests add the frame-by-frame sequences behind them: a car's
// scope, the line, teleports, garage time acceleration (Review Focus 4) and the session's end (Review Focus 3).
import { describe, expect, it } from 'vitest';
import type { OpenSpan, Span, SpanDeclaration } from '@pitwall/domain';
import type { SubMachine } from '../../../src/situations/machine.ts';
import { FRAME_MS, inputs, type InputEdit, type MachineInputBuilder } from '../../support/transition-table.ts';
import { car, car0, carStatus, inGarage, inLapOnTrack, inPitLane, leavingGarage, onOutLap, pushing, type CarFrame, type Timed } from './inputs.ts';

/** What one machine's tests need: the machine, its domain declaration, its phase, its session phase and its push kind. */
export type TimedActivity = {
  machine: SubMachine<unknown>;
  spans: SpanDeclaration;
  phase: 'qualifying' | 'practice';
  sessionPhaseId: 'session-phase-qualifying' | 'session-phase-practice';
  push: 'pushLap' | 'flyingLap';
  t: Timed;
};

type Run = { open: Array<OpenSpan | undefined>; closed: Array<Array<Omit<Span, 'endFrame'>>>; all: OpenSpan[][] };

/** One row of the w2/laps garage visit: lap, lap distance, lap timer, pit status, driver status. */
type GarageRow = [lap: number, d: number, timerMs: number, ps: CarFrame['ps'], ds: CarFrame['ds']];

/**
 * The garage visit on the same lap number of branch w2/laps (`test/history/laps-garage-restart.test.ts`), for the
 * machine: the pit lane passes the line, so the distance wraps in it (frame 4) without the lap number going up; the out
 * lap reaches the line as a wrap with the driver status still out lap (frame 11), and the game times lap 3 from there.
 */
export const GARAGE_VISIT: readonly GarageRow[] = [
  [2, 4_900, 88_000, 'none', 'flyingLap'], //    0  joined at the end of lap 2
  [3, 5, 100, 'none', 'flyingLap'], //           1  line: lap 2 done, lap 3 begins
  [3, 2_500, 45_000, 'none', 'inLap'], //        2  in lap
  [3, 4_950, 85_000, 'pitting', 'inLap'], //     3  pit entry
  [3, 40, 87_000, 'pitting', 'inLap'], //        4  the pit lane passes the line: the distance wraps, the lap number stays
  [3, 60, 88_000, 'pitting', 'inGarage'], //     5  in the garage
  [3, 60, 89_000, 'pitting', 'inGarage'], //     6  in the garage
  [3, 60, 90_000, 'pitting', 'outLap'], //       7  leaves the garage
  [3, 69, 97_000, 'none', 'outLap'], //          8  pit exit
  [3, 2_500, 130_000, 'none', 'outLap'], //      9  out lap
  [3, 4_950, 175_000, 'none', 'outLap'], //      10 out lap, just before the line
  [3, 3, 50, 'none', 'outLap'], //               11 the line: the timed lap 3 starts (the driver status still says out lap)
  [3, 2_500, 45_000, 'none', 'flyingLap'], //    12 timed lap
  [3, 4_900, 89_000, 'none', 'flyingLap'], //    13 timed lap
  [4, 5, 100, 'none', 'flyingLap'], //           14 line: lap 3 done
  [4, 2_500, 45_000, 'none', 'flyingLap'], //    15
];
/** The kind of each `GARAGE_VISIT` frame, the push kind `push`. */
export const garageVisitKinds = (push: string): string[] => [
  push, push, 'inLap', 'inLap', 'inLap', 'garage', 'garage', 'outLap', 'outLap', 'outLap', 'outLap', push, push, push, push, push,
];

/** Registers the shared tests for one timed car-activity machine. */
export const describeTimedActivity = ({ machine, spans, phase, sessionPhaseId, push, t }: TimedActivity): void => {
  const f = t.frame;
  /** Steps the machine through the frames: car `index`'s open span after each, the spans of the car each frame closed, every open span after each. */
  const run = (builder: MachineInputBuilder, index = 0): Run => {
    let open = machine.init();
    const result: Run = { open: [], closed: [], all: [] };
    for (const input of builder.build()) {
      const step = machine.step(open, input);
      open = step.open;
      const spans = machine.openSpans(open);
      result.all.push(spans);
      result.open.push(spans.find((s) => s.carId === index));
      result.closed.push(step.closed.filter((s) => s.carId === index));
    }
    return result;
  };
  const kinds = (r: Run) => r.open.map((s) => s?.kind);
  /** How many spans of the car the run closed. */
  const closedCount = (r: Run) => r.closed.flat().length;

  describe(`${machine.id}: id, span declaration, applies to, inputs`, () => {
    it(`is the sub-machine ${machine.id}, its spans the car-scoped declaration in domain, for the ${phase} phase only (C15, C17)`, () => {
      expect([machine.id, machine.spans, machine.appliesTo]).toEqual([spans.machine, spans, [phase]]);
      expect(machine.spans.scope).toBe('car');
      expect([...machine.spans.kinds].sort()).toEqual(['finished', 'garage', 'inLap', 'notCompeting', 'outLap', push].sort());
    });
    it(`reads the upstream car-location, car-status and ${sessionPhaseId} (weekend-phase through it, C14)`, () => {
      expect([...machine.inputs.upstream].sort()).toEqual(['car-location', 'car-status', sessionPhaseId].sort());
    });
    it('reads the signals driverStatus and resultStatus (pitStatus at most besides), and the timing values (the session’s track length at most besides)', () => {
      expect(machine.inputs.signals).toEqual(expect.arrayContaining(['driverStatus', 'resultStatus']));
      for (const signal of machine.inputs.signals) expect(['driverStatus', 'pitStatus', 'resultStatus']).toContain(signal);
      expect(machine.inputs.values).toEqual(expect.arrayContaining(['timing']));
      for (const area of machine.inputs.values) expect(['timing', 'session']).toContain(area);
    });
  });

  describe(`${machine.id}: a car’s scope begins with its first car-location span (C3, C26)`, () => {
    it('opens no span before the Participants data is in the live state (no car-location span), whatever the signals say', () => {
      const r = run(inputs().frames(3, t.bare(pushing(2_000))));
      expect(r.all.map((s) => s.length)).toEqual([0, 0, 0]);
      expect(closedCount(r)).toBe(0);
    });
    it('opens one span per car slot on the frame its first car-location span opens: joined, on that frame number, id 0, confirmed', () => {
      const r = run(inputs().frames(3, t.bare(pushing(2_000))).frame(f(pushing(2_050))));
      const opened = r.all[3]!;
      expect(opened.length).toBeGreaterThan(2);
      expect(opened.map((s) => s.carId)).toEqual(Array.from({ length: opened.length }, (_, i) => i));
      for (const s of opened) expect([s.machine, s.id, s.start, s.startFrame, s.joinedAt, s.confirmed]).toEqual([machine.id, 0, 3 * FRAME_MS, 4, true, true]);
      expect(opened[0]!.kind).toBe(push);
    });
    it('a slot no car of the session holds (car-status absent) is notCompeting from its first span on, and nothing changes it', () => {
      const r = run(inputs().frames(2, f()).frames(2, f(car(2, { ds: 'flyingLap', ps: 'none', d: 100 }))), 2);
      expect(kinds(r)).toEqual(Array(4).fill('notCompeting'));
      expect(closedCount(r)).toBe(0);
    });
    it('the next span of a car opens on the frame the last closes, without joinedAt, its id one more (C18, C26)', () => {
      const r = run(inputs().frames(3, f(inGarage())).frames(2, f(leavingGarage())));
      expect(r.open[3]).toMatchObject({ machine: machine.id, carId: 0, kind: 'outLap', id: 1, start: 3 * FRAME_MS, startFrame: 4, confirmed: true });
      expect(r.open[3]!.joinedAt).toBeUndefined();
      expect(r.closed[3]).toMatchObject([{ kind: 'garage', id: 0, start: 0, end: 3 * FRAME_MS, startFrame: 1, joinedAt: true }]);
      expect(r.open[4]).toEqual(r.open[3]);
    });
    it('a car’s activity does not touch another car’s spans', () => {
      const r = run(inputs().frames(2, f(car(1, { ds: 'flyingLap', ps: 'none', d: 1_000 }), inGarage())).frames(2, f(car(1, { ds: 'flyingLap', ps: 'none', d: 1_100 }), leavingGarage())), 1);
      expect(kinds(r)).toEqual(Array(4).fill(push));
      expect(closedCount(r)).toBe(0);
    });
  });

  describe(`${machine.id}: the out lap ends at the line on track (w2/laps, adapted)`, () => {
    const visit = (rows: readonly GarageRow[]) =>
      rows.reduce((b, [lap, d, timerMs, ps, ds]) => b.frame(f(car0({ ds, ps, d, lap, timerMs }))), inputs());
    it(`a garage visit on the same lap number: ${push}, inLap, garage, outLap, then ${push} from the line where the game times the lap`, () => {
      const r = run(visit(GARAGE_VISIT));
      expect(kinds(r)).toEqual(garageVisitKinds(push));
      expect(r.open[11]).toMatchObject({ kind: push, startFrame: 12 });
      expect(r.closed[11]).toMatchObject([{ kind: 'outLap', startFrame: 8 }]);
    });
    it(`the next line on a ${push} opens no span: one span across the laps`, () => {
      const r = run(inputs().frames(2, f(pushing(4_900, 2))).frame(f(pushing(5, 3, 100))).frames(2, f(pushing(2_000, 3))).frame(f(pushing(3, 4, 50))));
      expect(r.open.map((s) => [s?.kind, s?.id])).toEqual(Array(6).fill([push, 0]));
      expect(closedCount(r)).toBe(0);
    });
    it('a line in the pit lane (a garage box before the line, §2.3) is no line: the out lap ends at the line on track', () => {
      const r = run(
        inputs()
          .frames(2, f(inGarage(5_380)))
          .frame(f(leavingGarage(5_390)))
          .frame(f(leavingGarage(20)))
          .frame(f(onOutLap(250)))
          .frames(2, f(onOutLap(4_990)))
          .frame(f(onOutLap(4))),
      );
      expect(kinds(r)).toEqual(['garage', 'garage', 'outLap', 'outLap', 'outLap', 'outLap', 'outLap', push]);
    });
    it('the lap timer going back mid-lap (68131 -> 68008 ms, SgQ) or reset at the pit exit is no line', () => {
      const r = run(
        inputs()
          .frames(2, f(pushing(3_475, 2, 68_131)))
          .frame(f(pushing(3_476, 2, 68_008)))
          .frames(2, f(inGarage()))
          .frame(f(car0({ ds: 'outLap', ps: 'pitting', d: 79, timerMs: 6_833 })))
          .frame(f(car0({ ds: 'outLap', ps: 'none', d: 280, timerMs: 0 }))),
      );
      expect(kinds(r)).toEqual([push, push, push, 'garage', 'garage', 'outLap', 'outLap']);
    });
    it('the lap number going up without the lap distance at the line is no line', () => {
      const r = run(inputs().frames(2, f(onOutLap(2_000, 1))).frame(f(onOutLap(2_010, 2))));
      expect(kinds(r)).toEqual(['outLap', 'outLap', 'outLap']);
    });
  });

  describe(`${machine.id}: teleports are no lap and no transition except into garage`, () => {
    it('the player’s return to the garage mid-lap (ds 1 -> 0 with ps 0 and d 739 -> 33, then ps 1 and d 4929; SgQ 467.514): one transition, into garage', () => {
      const r = run(
        inputs()
          .frames(3, f(pushing(739, 4)))
          .frame(f(car0({ ds: 'inGarage', ps: 'none', d: 33, lap: 4 })))
          .frame(f(inGarage(4_929, 4)))
          .frames(2, f(inGarage(4_929, 4))),
      );
      expect(kinds(r)).toEqual([push, push, push, 'garage', 'garage', 'garage', 'garage']);
      expect(r.closed.flat().map((s) => s.kind)).toEqual([push]);
    });
    it('put on track under time acceleration (ds 0 -> 3, ps 1 -> 0, d -4896 -> -1539 in one frame; SgQ 138.968): outLap, the line only where the distance reaches 0', () => {
      const r = run(inputs().frames(2, f(inGarage(-4_896))).frame(f(onOutLap(-1_539))).frame(f(onOutLap(-800))).frame(f(onOutLap(-2))).frame(f(onOutLap(3))));
      expect(kinds(r)).toEqual(['garage', 'garage', 'outLap', 'outLap', 'outLap', push]);
    });
  });

  describe(`${machine.id}: garage time acceleration (Review Focus 4)`, () => {
    /** Session time up to 31.6× wall time: each frame (16 ms of wall time) advances 506 ms of the race clock. */
    const accelerated: InputEdit = (i, index) => {
      i.at = index * 506;
    };
    it('a car accelerated through the garage at 31.6× opens no lap and no activity transition', () => {
      const garage = [33, 4_929, 41, -4_875, 60, 4_929, 33, 60];
      const timers = [14_099, 0, 29_416, 0, 6_506, 0, 37_432, 0];
      const b = garage.reduce(
        (builder, d, k) =>
          builder.frame(
            f(
              accelerated,
              car0({ ds: 'inGarage', ps: k === 0 ? 'none' : 'pitting', d, lap: 4, timerMs: timers[k]! }),
              // car 1 on track at the same rate: 40 m a frame, across the line once
              car(1, { ds: 'flyingLap', ps: 'none', d: (4_850 + 40 * k) % 5_000, lap: 4_850 + 40 * k >= 5_000 ? 3 : 2, timerMs: 80_000 + 506 * k }),
            ),
          ),
        inputs(),
      );
      const r = run(b);
      expect(r.open.map((s) => [s?.kind, s?.id])).toEqual(Array(garage.length).fill(['garage', 0]));
      expect(closedCount(r)).toBe(0);
      const other = run(b, 1);
      expect(other.open.map((s) => [s?.kind, s?.id])).toEqual(Array(garage.length).fill([push, 0]));
      expect(closedCount(other)).toBe(0);
    });
  });

  describe(`${machine.id}: the session’s end (Review Focus 3)`, () => {
    /** The time-out frame of SgQ (900.594): every car's result status finished wherever it is. */
    const timeOut = (): InputEdit =>
      f(
        car0({ ds: 'inLap', ps: 'none', d: 4_818, lap: 3, rs: 'finished' }),
        car(1, { ds: 'inLap', ps: 'none', d: 4_929, lap: 3, rs: 'finished' }),
        t.sessionPhase('finished'),
      );
    const before = (): InputEdit => f(pushing(4_818, 2, 91_925), car(1, { ds: 'inLap', ps: 'none', d: 652, lap: 3, timerMs: 11_929 }));
    it(`a car set to finished mid-lap is not finished: its ${push} ends, inLap; an in lap stays the in lap`, () => {
      const b = inputs().frames(3, before()).frame(timeOut()).frame(f(t.sessionPhase('postSession')));
      const r = run(b);
      expect(kinds(r)).toEqual([push, push, push, 'inLap', 'inLap']);
      const other = run(b, 1);
      expect(kinds(other)).toEqual(Array(5).fill('inLap'));
      expect(closedCount(other)).toBe(0);
      expect(run(b).all.flat().some((s) => s.kind === 'finished')).toBe(false);
    });
    it('a car in the garage at the session’s end stays garage', () => {
      const r = run(inputs().frames(3, f(inGarage(33, 4))).frame(f(car0({ ds: 'inGarage', ps: 'pitting', d: 33, lap: 4, rs: 'finished' }), t.sessionPhase('finished'))).frame(f(t.sessionPhase('postSession'))));
      expect(kinds(r)).toEqual(Array(5).fill('garage'));
      expect(closedCount(r)).toBe(0);
    });
    it('a finished car stays finished on track, a later wrap included, until it reaches the garage', () => {
      const done = (d: number, ds: CarFrame['ds'] = 'onTrack', ps: CarFrame['ps'] = 'none'): InputEdit => f(car0({ ds, ps, d, lap: 3, rs: 'finished' }));
      const r = run(inputs().frames(2, f(pushing(4_980, 3))).frame(done(4)).frame(done(2_500)).frame(done(4_990)).frame(done(5)).frame(done(4_960, 'inLap', 'pitting')).frame(done(60, 'inGarage', 'pitting')));
      expect(kinds(r)).toEqual([push, push, 'finished', 'finished', 'finished', 'finished', 'finished', 'garage']);
    });
  });

  describe(`${machine.id}: notCompeting while car-status is retired, disqualified or absent`, () => {
    it('a retired car teleported into its garage stays notCompeting', () => {
      const r = run(inputs().frames(2, f(pushing(1_000, 2))).frames(2, f(carStatus(0, 'retired'), car0({ ds: 'onTrack', ps: 'none', d: 1_010, lap: 2, rs: 'retired' }))).frames(2, f(car0({ ds: 'inGarage', ps: 'pitting', d: 60, lap: 2, rs: 'retired' }))));
      expect(kinds(r)).toEqual([push, push, 'notCompeting', 'notCompeting', 'notCompeting', 'notCompeting']);
    });
    it('in the pit lane on the in lap, then into the garage: the in lap holds through the pit lane', () => {
      const r = run(inputs().frames(2, f(inLapOnTrack(4_900, 2))).frames(2, f(inPitLane(4_960, 2))).frame(f(inGarage(60, 2))));
      expect(kinds(r)).toEqual(['inLap', 'inLap', 'inLap', 'inLap', 'garage']);
    });
  });
};
