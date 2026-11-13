// What `forecast-score`'s job does per situation (contract C14, C43, C44): one row per kind of every sub-machine the
// job reads (`spans:<machine>`). The machine decided the situations; the job copies their spans into its input and
// reads them only as these rows say: who drove a case's car, which periods were neutralised, and, as of a predict
// frame, the spans the forecast units read.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What a span means to the scoreboard. */
export type ForecastScoreEffect = {
  /** The weekend phase is the race: the forecast units build starting points and the cases are scored. */
  race?: boolean;
  /** The weekend phase is not the race (C14): the forecast units report `notApplicable`, no case is scored. */
  notApplicable?: boolean;
  /** Who drove the car at a case's predict frame: its case goes to the AI or the human table. */
  driver?: 'ai' | 'human';
  /** A neutralised period: an experiment's scenario carries it as an SC or VSC period. */
  neutralised?: boolean;
  /** A span the forecast units read as of a predict frame (the job hands it on and reads nothing of it itself). */
  asOf?: boolean;
};

const RACE: ForecastScoreEffect = { race: true };
const NOT_RACE: ForecastScoreEffect = { notApplicable: true };
const PHASE: ForecastScoreEffect = {};
const AS_OF: ForecastScoreEffect = { asOf: true };

/** One row per kind of every sub-machine the job reads (C44). `weekend-phase` `none` is `notApplicable` (C14). */
export const FORECAST_SCORE_BEHAVIOUR: BehaviourTable<ForecastScoreEffect> = {
  'weekend-phase': { practice: NOT_RACE, qualifying: NOT_RACE, race: RACE, none: NOT_RACE },
  'car-driver': { ai: { driver: 'ai' }, human: { driver: 'human' } },
  'session-phase-race': {
    grid: PHASE,
    formation: PHASE,
    startLights: PHASE,
    racing: PHASE,
    neutralised: { neutralised: true },
    suspended: PHASE,
    finished: PHASE,
    postSession: PHASE,
  },
  'car-status': { competing: AS_OF, retired: AS_OF, disqualified: AS_OF, absent: AS_OF },
  'compound-rule': { required: AS_OF, waived: AS_OF },
};
