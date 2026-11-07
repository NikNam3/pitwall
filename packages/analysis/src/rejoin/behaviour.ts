// What `rejoin` does per situation (contract C14, C43, C44, SP4.2 spec 3.2): one row per kind of every sub-machine it
// reads. The machine decided the situation; the calculator only looks up the rows of the spans open now.
import { carActivityRaceSpans, carStatusSpans, weekendPhaseSpans } from '@pitwall/domain';
import { GAPS_BEHAVIOUR, type GapsRow } from '../gaps/behaviour.ts';
import type { BehaviourTable } from '../shared/behaviour.ts';

/**
 * A row. `race`: the weekend phase is the race, the ghost is computed. `notApplicable`: the weekend phase is not the
 * race, or our car is not where a stop can start (in the pit lane, on its out lap, finished): no entry. `car`: what
 * a car's status makes of it, as `gaps` reads it (only a `running` car of ours has an entry).
 */
export type RejoinEffect = { race?: true; notApplicable?: true } | Extract<GapsRow, { car: unknown }>;

const NONE: RejoinEffect = {};
const NOT_APPLICABLE: RejoinEffect = { notApplicable: true };

const activityRows = Object.fromEntries(carActivityRaceSpans.kinds.map((kind) => [kind, NOT_APPLICABLE])) as Record<string, RejoinEffect>;

export const REJOIN_BEHAVIOUR: BehaviourTable<RejoinEffect> = {
  [weekendPhaseSpans.machine]: { race: { race: true }, practice: NOT_APPLICABLE, qualifying: NOT_APPLICABLE, none: NOT_APPLICABLE },
  [carActivityRaceSpans.machine]: { ...activityRows, racingLap: NONE, inLap: NONE },
  [carStatusSpans.machine]: GAPS_BEHAVIOUR[carStatusSpans.machine] as Record<string, RejoinEffect>,
};
