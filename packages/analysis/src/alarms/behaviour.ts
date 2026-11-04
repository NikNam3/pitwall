// The alarms behaviour table (C44): what each kind of the warnings and penalties sub-machines means for the alarms.
// The machine decides what a car holds or owes; the calculator only looks up the row of the span open now.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What an open span of a kind asks of the alarms: nothing, a warning count to judge, or a penalty to announce. */
export type AlarmRow = { raises: 'nothing' } | { raises: 'warning' } | { raises: 'penalty'; penalty: 'time' | 'driveThrough' | 'stopGo' };

const NOTHING: AlarmRow = { raises: 'nothing' };

/** One row per kind of `warnings` and `penalties`. */
export const ALARMS_BEHAVIOUR = {
  warnings: { noWarning: NOTHING, warned: { raises: 'warning' } },
  penalties: {
    clear: NOTHING,
    timePenalty: { raises: 'penalty', penalty: 'time' },
    driveThroughPending: { raises: 'penalty', penalty: 'driveThrough' },
    stopGoPending: { raises: 'penalty', penalty: 'stopGo' },
  },
} as const satisfies BehaviourTable<AlarmRow>;
