import { known, unknown } from '@pitwall/domain';
import type { Known, Ms } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { SESSION_REMAINING } from './index.ts';
import type { SessionRemaining } from './index.ts';

/** Laps left in a race (fractional, from the leader's progress) or the time left in a timed session. */
export const sessionRemainingCalculator: QuickCalculator<SessionRemaining> = {
  id: SESSION_REMAINING,
  kind: 'quick',
  reads: ['session', 'timing'],
  cadence: { hz: 1 },
  compute: ({ state }): SessionRemaining => {
    const { session, sessionTime: at } = state;
    const notApplicable = unknown('notApplicable');
    switch (session.kind) {
      case 'race': {
        const leader = state.cars.find((c) => c.timing.position === 1);
        let lapsLeft: Known<number>;
        if (!leader || session.trackLengthM <= 0 || session.totalLaps <= 0) lapsLeft = unknown('notReceived');
        else if (leader.timing.resultStatus === 'finished') lapsLeft = known(0, at);
        else {
          const done = leader.timing.lap - 1 + leader.timing.lapDistanceM / session.trackLengthM;
          lapsLeft = known(Math.max(0, session.totalLaps - done), at);
        }
        return { basis: 'laps', lapsLeft, timeLeftMs: notApplicable };
      }
      case 'practice':
      case 'qualifying':
      case 'sprintShootout': {
        const timeLeftMs: Known<Ms> = known(session.timeLeftMs, at);
        return { basis: 'time', lapsLeft: notApplicable, timeLeftMs };
      }
      case 'timeTrial':
        return { basis: 'time', lapsLeft: notApplicable, timeLeftMs: notApplicable };
      default:
        return { basis: 'laps', lapsLeft: unknown('notReceived'), timeLeftMs: unknown('notReceived') };
    }
  },
};
