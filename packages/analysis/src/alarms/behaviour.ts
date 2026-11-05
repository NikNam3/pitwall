// The alarms behaviour table (C43, C44): what each kind of the weekend-phase, warnings, penalties and race session-phase
// sub-machines means for the alarms. The machine decides what a car holds or owes and what the session does; the
// calculator only looks up the rows of the spans open now, the car's and the session's, and merges them (as `lap-times`
// does).
import { JUDGED_LAP_PHASE_ROWS } from '../car-bands/bands.ts';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations open for a car ask of its alarms; every field absent means "nothing". */
export type AlarmsEffect = {
  /**
   * The session judges the warning count of the car's `warned` span: its corner-cutting warnings (`cornerCutting`), the
   * only ones that lead to a penalty. Races only: practice reaches many warnings without one.
   */
  warningCount?: 'cornerCutting';
  /** The car owes race control a penalty, to announce. */
  penalty?: 'time' | 'driveThrough' | 'stopGo';
  /**
   * The band alarms (`bandOut`, `bandOutLap`) are hidden: the field runs neutralised, so the bands say nothing of the
   * car. They are raised again, from the judged lap, once the neutralisation holds its `returning` stage (the game's
   * "safety car in this lap"; the VSC's ending the same).
   */
  bandsHidden?: true;
  /** The session is a race: lap 1 is not judged (`judgedLaps`, the row `car-bands` uses). */
  isRace?: true;
};

const NOTHING: AlarmsEffect = {};

/**
 * The `weekend-phase` rows: the judged lap's (`car-bands`' rows, so both judge the same lap, C43), and in a race the
 * last-warning alarm on the corner-cutting warnings; the warned span's row asks for nothing, so no other phase raises it.
 */
const WEEKEND_PHASE_ROWS = {
  ...JUDGED_LAP_PHASE_ROWS,
  race: { ...JUDGED_LAP_PHASE_ROWS.race, warningCount: 'cornerCutting' },
} as const satisfies Record<keyof typeof JUDGED_LAP_PHASE_ROWS, AlarmsEffect>;

/** One row per kind of `weekend-phase`, `warnings`, `penalties` and `session-phase-race`. */
export const ALARMS_BEHAVIOUR = {
  'weekend-phase': WEEKEND_PHASE_ROWS,
  // a warned span's count is judged only where the weekend phase's row asks for it
  warnings: { noWarning: NOTHING, warned: NOTHING },
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
