// What `car-bands` does per situation (contract C43, C44): one row per kind of every sub-machine it reads. The machine
// decided the situation; the calculator only looks up the rows of the spans open for a car and merges them. Its last
// lap counts by activity through the lap record (in and out laps), and a rate lap has no lap-1 rule.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations open for a car say about its bands; every field absent means "no change". */
export type CarBandsEffect = {
  /** The car is in the session and has an entry; set by car-status, so a slot without its span has none (C17). */
  inSession?: boolean;
  /**
   * The car stands in its box: the bands are off, every live state `notApplicable`. Values, bands and the last lap's
   * judgement (`outForFullLap`) stay.
   */
  bandsOff?: true;
};

const IN: CarBandsEffect = { inSession: true };
const ON: CarBandsEffect = {};

export const CAR_BANDS_BEHAVIOUR: BehaviourTable<CarBandsEffect> = {
  'car-status': { competing: IN, retired: IN, disqualified: IN, absent: { inSession: false } },
  'car-activity-race': {
    racingLap: ON,
    inLap: ON,
    boxStop: { bandsOff: true },
    servingPenalty: ON,
    outLap: ON,
    finished: ON,
    coolDown: ON,
    notCompeting: ON,
  },
};
