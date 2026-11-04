// `session-remaining` (spec 4, A.2): laps left in a race, time left in a timed session, by the weekend phase (C14) and,
// in a race, the leader's activity (C44: one test per row of the behaviour table). The live session stays the builder's
// race: the unit takes the phase from the situation, not from `session.kind`.
import { carId, unknown, type CarState, type OpenSpan, type WeekendPhase } from '@pitwall/domain';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { describe, expect, it } from 'vitest';
import { carState, engineView } from '../../../../test-support/builders/index.ts';
import { sessionRemainingCalculator } from '../../src/session-remaining/calculator.ts';
import { SESSION_REMAINING } from '../../src/session-remaining/index.ts';

const RACE: WeekendPhase = { kind: 'race', format: 'grandPrix' };
const PRACTICE: WeekendPhase = { kind: 'practice', format: 'practice', segment: undefined };
const QUALI: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 1 };

const span = (machine: string, kind: string, car?: number, detail?: unknown): OpenSpan => ({
  machine,
  id: 0,
  kind,
  start: 0,
  confirmed: true,
  detail,
  startFrame: 1,
  ...(car !== undefined && { carId: carId(car) }),
});

const leader = (lap: number, lapDistanceM: number, resultStatus?: CarState['timing']['resultStatus']): CarState => {
  const car = carState({ id: 0 as CarState['id'], timing: { position: 1, lap, lapDistanceM } });
  if (resultStatus) car.timing.resultStatus = resultStatus;
  return car;
};

/** A view in `phase` whose leader (car 0) has this race activity open (none for another phase). */
const view = (phase: WeekendPhase, cars: CarState[], session: Parameters<typeof engineView>[0] extends infer O ? (O extends { session?: infer S } ? S : never) : never, activity?: string) =>
  engineView({
    cars,
    session,
    situation: {
      weekendPhase: phase,
      byMachine: {
        ...(phase.kind !== 'pending' && { 'weekend-phase': [span('weekend-phase', phase.kind, undefined, 'format' in phase ? { format: phase.format } : undefined)] }),
        ...(activity !== undefined && { 'car-activity-race': [span('car-activity-race', activity, 0)] }),
      },
    },
  });

/** `compute` through the guarded view: a read the calculator does not declare throws (C41). */
const compute = (v: ReturnType<typeof view>) => sessionRemainingCalculator.compute(guardedView(v, sessionRemainingCalculator.reads, { unit: 'session-remaining' }));

const RACE_SESSION = { kind: 'race', totalLaps: 50, trackLengthM: 5000 } as const;

describe('session-remaining', () => {
  it('has the id session-remaining and reads the weekend phase and the leader\'s race activity (C41)', () => {
    expect(sessionRemainingCalculator.id).toBe(SESSION_REMAINING);
    expect(sessionRemainingCalculator.id).toBe('session-remaining');
    expect(sessionRemainingCalculator.reads).toEqual(expect.arrayContaining(['session', 'timing', 'spans:weekend-phase', 'spans:car-activity-race']));
  });

  describe('row weekend-phase race', () => {
    it('race of 50 laps, leader on lap 20 at 40 % of the lap: lapsLeft 30.6, basis laps', () => {
      const out = compute(view(RACE, [leader(20, 2000)], RACE_SESSION, 'racingLap'));
      expect(out.basis).toBe('laps');
      expect(out.lapsLeft.known && out.lapsLeft.value).toBeCloseTo(30.6, 6);
      expect(out.timeLeftMs).toMatchObject({ known: false, reason: 'notApplicable' });
    });

    it('a race without a lap count yet (totalLaps 0) has lapsLeft notReceived, not 0', () => {
      const out = compute(view(RACE, [leader(3, 1000)], { ...RACE_SESSION, totalLaps: 0 }, 'racingLap'));
      expect(out.lapsLeft).toEqual({ known: false, reason: 'notReceived' });
    });

    it('a race without a leader has lapsLeft notReceived', () => {
      expect(compute(view(RACE, [], RACE_SESSION)).lapsLeft).toEqual({ known: false, reason: 'notReceived' });
    });
  });

  // The leader's race activity: `finished` (one frame at the flag) and `coolDown` mean the race is over for it: 0 laps left.
  describe('row car-activity-race of the leader', () => {
    it.each(['finished', 'coolDown'])('%s: lapsLeft is 0 (known), basis laps', (activity) => {
      const out = compute(view(RACE, [leader(50, 4900)], RACE_SESSION, activity));
      expect(out.basis).toBe('laps');
      expect(out.lapsLeft).toMatchObject({ known: true, value: 0 });
    });

    it.each(['racingLap', 'inLap', 'boxStop', 'servingPenalty', 'outLap', 'notCompeting'])('%s: laps left from the leader\'s progress', (activity) => {
      const out = compute(view(RACE, [leader(50, 4900)], RACE_SESSION, activity));
      expect(out.lapsLeft.known && out.lapsLeft.value).toBeCloseTo(0.02, 6);
    });

    it('the game\'s result status is no signal here: a leader with resultStatus finished but still racing has laps left', () => {
      const out = compute(view(RACE, [leader(50, 4900, 'finished')], RACE_SESSION, 'racingLap'));
      expect(out.lapsLeft.known && out.lapsLeft.value).toBeCloseTo(0.02, 6);
    });

    it('only the leader\'s activity counts: another car finished does not end the race', () => {
      const other = carState({ id: 1 as CarState['id'], timing: { position: 2, lap: 50, lapDistanceM: 4000 } });
      const v = engineView({
        cars: [leader(49, 2000), other],
        session: RACE_SESSION,
        situation: { weekendPhase: RACE, byMachine: { 'weekend-phase': [span('weekend-phase', 'race')], 'car-activity-race': [span('car-activity-race', 'racingLap', 0), span('car-activity-race', 'finished', 1)] } },
      });
      expect(compute(v).lapsLeft).toMatchObject({ known: true });
      expect((compute(v).lapsLeft as { value: number }).value).toBeGreaterThan(0);
    });
  });

  describe('row weekend-phase practice and qualifying', () => {
    it.each([
      ['practice', PRACTICE],
      ['qualifying', QUALI],
    ])('%s: basis time, timeLeftMs from the session, lapsLeft notApplicable', (_, phase) => {
      const out = compute(view(phase, [leader(3, 1000)], { totalLaps: 0, timeLeftMs: 1_234_000 }));
      expect(out.basis).toBe('time');
      expect(out.timeLeftMs).toMatchObject({ known: true, value: 1_234_000 });
      expect(out.lapsLeft).toMatchObject({ known: false, reason: 'notApplicable' });
    });
  });

  describe('row weekend-phase none', () => {
    it('time trial or unknown session type: both notApplicable', () => {
      const out = compute(view({ kind: 'none' }, [leader(1, 0)], {}));
      expect(out.lapsLeft).toMatchObject({ known: false, reason: 'notApplicable' });
      expect(out.timeLeftMs).toMatchObject({ known: false, reason: 'notApplicable' });
    });
  });

  describe('weekend phase still pending (no span yet)', () => {
    it('readers treat the session as on the grid: basis laps, both notReceived', () => {
      const out = compute(view({ kind: 'pending' }, [leader(1, 0)], RACE_SESSION));
      expect(out.basis).toBe('laps');
      expect(out.lapsLeft).toEqual(unknown('notReceived'));
      expect(out.timeLeftMs).toEqual(unknown('notReceived'));
    });
  });
});
