// What `circle` does per situation (contract C14, C43, C44, SP4.3d spec §6.5): one row per kind of every sub-machine it
// reads. The machine decided the situation; the calculator only looks up the rows of the spans open now.
import { carStatusSpans, sessionPhaseRaceSpans, weekendPhaseSpans } from '@pitwall/domain';
import { GAPS_BEHAVIOUR, type GapsRow } from '../gaps/behaviour.ts';
import type { BehaviourTable } from '../shared/behaviour.ts';

/**
 * A row. `race`: the weekend phase is the race, the circle is computed. `notApplicable`: the weekend phase is not the
 * race: no circle. `neutralised`: the race runs under an SC or a VSC (its condition is the span's car); every other
 * race phase is green. `car`: what a car's status makes of it, as `gaps` reads it: only a `running` car is on a circle,
 * and only a `running` car of ours has one.
 */
export type CircleEffect = { race?: true; notApplicable?: true; neutralised?: true } | Extract<GapsRow, { car: unknown }>;

const GREEN: CircleEffect = {};
const NOT_APPLICABLE: CircleEffect = { notApplicable: true };

const phaseRows = Object.fromEntries(sessionPhaseRaceSpans.kinds.map((kind) => [kind, GREEN])) as Record<string, CircleEffect>;

export const CIRCLE_BEHAVIOUR: BehaviourTable<CircleEffect> = {
  [weekendPhaseSpans.machine]: { race: { race: true }, practice: NOT_APPLICABLE, qualifying: NOT_APPLICABLE, none: NOT_APPLICABLE },
  [sessionPhaseRaceSpans.machine]: { ...phaseRows, neutralised: { neutralised: true } },
  [carStatusSpans.machine]: GAPS_BEHAVIOUR[carStatusSpans.machine] as Record<string, CircleEffect>,
};
