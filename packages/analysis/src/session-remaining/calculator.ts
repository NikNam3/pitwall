import { known, unknown } from '@pitwall/domain';
import type { Known, Ms } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine/readers';
import { GAPS, type GapsOutput } from '../gaps/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { SESSION_REMAINING_BEHAVIOUR, type SessionRemainingEffect } from './behaviour.ts';
import { SESSION_REMAINING } from './index.ts';
import type { SessionRemaining } from './index.ts';

/**
 * Laps left in a race (fractional, from the leader's progress) or the time left in a timed session. The leader and its
 * progress are `gaps`' (the order's first car, `leaderProgress`; SP4.3c Task 6, C43).
 */
export const sessionRemainingCalculator: QuickCalculator<SessionRemaining> = {
  id: SESSION_REMAINING,
  kind: 'quick',
  reads: ['session', 'spans:weekend-phase', 'spans:car-activity-race', { calculator: GAPS }],
  cadence: { hz: 1 },
  compute: (view): SessionRemaining => {
    const { session, sessionTime: at } = view.live;
    const notApplicable = unknown('notApplicable');
    const gaps = view.outputs.get(GAPS) as GapsOutput | undefined;
    const leader = gaps?.intervals[0]?.carId;
    const progress = gaps?.leaderProgress ?? unknown('notReceived');
    const effect: SessionRemainingEffect = Object.assign({}, ...behaviourFor(SESSION_REMAINING_BEHAVIOUR, view, leader));
    switch (effect.basis) {
      case 'laps': {
        let lapsLeft: Known<number>;
        if (leader === undefined || session.totalLaps <= 0) lapsLeft = unknown('notReceived');
        else if (effect.over) lapsLeft = known(0, at);
        else if (!progress.known) lapsLeft = unknown(progress.reason);
        else {
          const done = progress.value.lap - 1 + progress.value.fraction;
          lapsLeft = known(Math.max(0, session.totalLaps - done), at);
        }
        return { basis: 'laps', lapsLeft, timeLeftMs: notApplicable };
      }
      case 'time': {
        const timeLeftMs: Known<Ms> = known(session.timeLeftMs, at);
        return { basis: 'time', lapsLeft: notApplicable, timeLeftMs };
      }
      case 'none':
        return { basis: 'time', lapsLeft: notApplicable, timeLeftMs: notApplicable };
      default:
        // the weekend phase is still pending: it counts as on the grid and nothing depends on the phase yet (C14, C3)
        return { basis: 'laps', lapsLeft: unknown('notReceived'), timeLeftMs: unknown('notReceived') };
    }
  },
};
