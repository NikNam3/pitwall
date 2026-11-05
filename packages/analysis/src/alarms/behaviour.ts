// The alarms behaviour table (C43, C44): what each kind of the warnings, penalties and race session-phase sub-machines
// means for the alarms. The machine decides what a car holds or owes and what the session does; the calculator only
// looks up the rows of the spans open now, the car's and the session's, and merges them (as `lap-times` does).
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations open for a car ask of its alarms; every field absent means "nothing". */
export type AlarmsEffect = {
  /** The car holds warnings: the warning count to judge, the game's total or its corner-cutting warnings. */
  warningCount?: 'total' | 'cornerCutting';
  /** The car owes race control a penalty, to announce. */
  penalty?: 'time' | 'driveThrough' | 'stopGo';
  /**
   * The band alarms (`bandOut`, `bandOutLap`) are hidden: the field runs neutralised, so the bands say nothing of the
   * car. They are raised again, from the judged lap, once the neutralisation holds its `returning` stage (the game's
   * "safety car in this lap"; the VSC's ending the same).
   */
  bandsHidden?: true;
};

const NOTHING: AlarmsEffect = {};

/** One row per kind of `warnings`, `penalties` and `session-phase-race`. */
export const ALARMS_BEHAVIOUR = {
  warnings: { noWarning: NOTHING, warned: { warningCount: 'total' } },
  penalties: {
    clear: NOTHING,
    timePenalty: { penalty: 'time' },
    driveThroughPending: { penalty: 'driveThrough' },
    stopGoPending: { penalty: 'stopGo' },
  },
  'session-phase-race': {
    grid: NOTHING,
    formation: NOTHING,
    startLights: NOTHING,
    racing: NOTHING,
    neutralised: { bandsHidden: true },
    // a red flag hides nothing (supervisor ruling 2026-11-05)
    suspended: NOTHING,
    finished: NOTHING,
    postSession: NOTHING,
  },
} as const satisfies BehaviourTable<AlarmsEffect>;
