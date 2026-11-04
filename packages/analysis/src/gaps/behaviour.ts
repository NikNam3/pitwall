// What each situation means for `gaps` (contract C14, C17, C43, C44): one row per kind of every sub-machine it reads.
// The machine decides the situation; `gaps` looks up its row for the spans open now and decides nothing again.
import { carStatusSpans, sessionPhasePracticeSpans, sessionPhaseQualifyingSpans, sessionPhaseRaceSpans, weekendPhaseSpans } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/**
 * A row. `race`: the race-only parts apply (race start, positions gained, the gapper's phases); `none` for a session
 * phase of the race means nothing for them, they depend on the weekend phase. `car`: what a car's status makes of it in
 * the intervals: `running` is an interval and a neighbour, `out` is listed as out of the race (no interval), `absent`
 * is not in the session.
 */
export type GapsRow = { race: boolean } | { car: 'running' | 'out' | 'absent' };

const allow = (kinds: readonly string[], row: GapsRow): Record<string, GapsRow> => Object.fromEntries(kinds.map((k) => [k, row]));

export const GAPS_BEHAVIOUR: BehaviourTable<GapsRow> = {
  [weekendPhaseSpans.machine]: { ...allow(weekendPhaseSpans.kinds, { race: false }), race: { race: true } },
  // the race phases only matter for gaps through their neutralisations (the gapper's bands) and the first `racing`
  [sessionPhaseRaceSpans.machine]: allow(sessionPhaseRaceSpans.kinds, { race: true }),
  [sessionPhaseQualifyingSpans.machine]: allow(sessionPhaseQualifyingSpans.kinds, { race: false }),
  [sessionPhasePracticeSpans.machine]: allow(sessionPhasePracticeSpans.kinds, { race: false }),
  [carStatusSpans.machine]: { competing: { car: 'running' }, retired: { car: 'out' }, disqualified: { car: 'out' }, absent: { car: 'absent' } },
};
