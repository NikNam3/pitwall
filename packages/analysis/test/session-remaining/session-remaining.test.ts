// `session-remaining` (spec 4, A.2): laps left in a race, time left in a timed session.
import { describe, expect, it } from 'vitest';
import type { CarState } from '@pitwall/domain';
import { carState, engineView } from '../../../../test-support/builders/index.ts';
import { sessionRemainingCalculator } from '../../src/session-remaining/calculator.ts';
import { SESSION_REMAINING } from '../../src/session-remaining/index.ts';

const leader = (lap: number, lapDistanceM: number, resultStatus?: CarState['timing']['resultStatus']): CarState => {
  const car = carState({ id: 0 as CarState['id'], timing: { position: 1, lap, lapDistanceM } });
  if (resultStatus) car.timing.resultStatus = resultStatus;
  return car;
};

describe('session-remaining', () => {
  it('has the id session-remaining', () => {
    expect(sessionRemainingCalculator.id).toBe(SESSION_REMAINING);
    expect(sessionRemainingCalculator.id).toBe('session-remaining');
  });

  it('race of 50 laps, leader on lap 20 at 40 % of the lap: lapsLeft 30.6, basis laps', () => {
    const view = engineView({
      cars: [leader(20, 2000)],
      session: { kind: 'race', totalLaps: 50, trackLengthM: 5000 },
    });
    const out = sessionRemainingCalculator.compute(view);
    expect(out.basis).toBe('laps');
    expect(out.lapsLeft.known && out.lapsLeft.value).toBeCloseTo(30.6, 6);
    expect(out.timeLeftMs).toMatchObject({ known: false, reason: 'notApplicable' });
  });

  it('practice: basis time, timeLeftMs from the session, lapsLeft notApplicable', () => {
    const view = engineView({
      cars: [leader(3, 1000)],
      session: { kind: 'practice', totalLaps: 0, timeLeftMs: 1_234_000 },
    });
    const out = sessionRemainingCalculator.compute(view);
    expect(out.basis).toBe('time');
    expect(out.timeLeftMs).toMatchObject({ known: true, value: 1_234_000 });
    expect(out.lapsLeft).toMatchObject({ known: false, reason: 'notApplicable' });
  });

  it('time trial: both notApplicable', () => {
    const view = engineView({ cars: [leader(1, 0)], session: { kind: 'timeTrial' } });
    const out = sessionRemainingCalculator.compute(view);
    expect(out.lapsLeft).toMatchObject({ known: false, reason: 'notApplicable' });
    expect(out.timeLeftMs).toMatchObject({ known: false, reason: 'notApplicable' });
  });

  it('a race without a lap count yet (totalLaps 0) has lapsLeft notReceived, not 0', () => {
    const view = engineView({ cars: [leader(3, 1000)], session: { kind: 'race', totalLaps: 0, trackLengthM: 5000 } });
    expect(sessionRemainingCalculator.compute(view).lapsLeft).toEqual({ known: false, reason: 'notReceived' });
  });

  it('after the chequered flag lapsLeft is 0', () => {
    const view = engineView({
      cars: [leader(50, 4900, 'finished')],
      session: { kind: 'race', totalLaps: 50, trackLengthM: 5000 },
    });
    const out = sessionRemainingCalculator.compute(view);
    expect(out.basis).toBe('laps');
    expect(out.lapsLeft).toMatchObject({ known: true, value: 0 });
  });
});
