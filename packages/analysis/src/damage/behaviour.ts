// What `damage` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The machine
// decided the situation; the calculator only looks up the rows of the spans open for a car and merges them, and the
// rows of the spans, open or closed, that keep a mini-sector out of a jump's estimate (`noSample`). Its pace laps by
// activity come from the lap records (in and out laps).
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations open for a car say about its damage; every field absent means "no change". */
export type DamageEffect = {
  /** The car is in the session and has an entry; set by car-status, so a slot without its span has none (C17). */
  inSession?: boolean;
  /** Lap 1 is a standing start, no pace lap for a jump's loss (`lap-classes`): only in a race. */
  isRace?: boolean;
  /** A jump's loss can be measured: not without a weekend phase (`none`, a time trial), where it is `notApplicable`. */
  measured?: boolean;
  /**
   * A mini-sector of the car that shares a frame with the span is no sample (spec 3.5, C26): neither in a jump's
   * baseline (the segment medians) nor in its estimate. A pit visit or a garage spell of the car; a neutralisation of
   * every car.
   */
  noSample?: true;
};

const IN: DamageEffect = { inSession: true };
const TIMED: DamageEffect = { isRace: false, measured: true };
/** Wherever the car is, its damage is live: a repair in the garage or the pit lane shows at once, as on track. */
const LIVE: DamageEffect = {};
/** A pit visit or a garage spell: damage stays live, its mini-sectors are no samples. */
const OFF_TRACK: DamageEffect = { noSample: true };
/** A session phase with racing pace (or none at all): no effect. */
const NONE: DamageEffect = {};
/** A neutralisation (SC, VSC, red flag; `shared/neutralised.ts`): its mini-sectors are no samples. */
const NEUTRALISED: DamageEffect = { noSample: true };

export const DAMAGE_BEHAVIOUR: BehaviourTable<DamageEffect> = {
  'weekend-phase': { practice: TIMED, qualifying: TIMED, race: { isRace: true, measured: true }, none: { isRace: false, measured: false } },
  'car-status': { competing: IN, retired: IN, disqualified: IN, absent: { inSession: false } },
  'car-location': { garage: OFF_TRACK, pitLane: OFF_TRACK, track: LIVE },
  'session-phase-race': {
    grid: NONE,
    formation: NONE,
    startLights: NONE,
    racing: NONE,
    neutralised: NEUTRALISED,
    suspended: NEUTRALISED,
    finished: NONE,
    postSession: NONE,
  },
  'session-phase-qualifying': { grid: NONE, running: NONE, suspended: NEUTRALISED, finished: NONE, postSession: NONE },
  'session-phase-practice': { grid: NONE, running: NONE, suspended: NEUTRALISED, finished: NONE, postSession: NONE },
};
