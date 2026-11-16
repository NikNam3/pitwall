// What `strategy-overview` does per situation (contract C17, C43, C44, SP4.3d spec §6.4): one row per kind of every
// sub-machine it reads. The machine decided the situation; the calculator only looks up the rows of the spans open now.
import { carStatusSpans, sessionPhaseRaceSpans } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/**
 * A row. `competing`: what a car's status makes of it: only a competing car is a row of the overview (a retired or
 * disqualified car has no strategy left, an absent one is not in the session). A session phase of the race changes
 * nothing: the overview holds in every phase of the race (`{}`).
 */
export type StrategyOverviewEffect = { competing?: boolean };

const ALL_PHASES = Object.fromEntries(sessionPhaseRaceSpans.kinds.map((kind) => [kind, {}])) as Record<string, StrategyOverviewEffect>;

export const STRATEGY_OVERVIEW_BEHAVIOUR: BehaviourTable<StrategyOverviewEffect> = {
  [sessionPhaseRaceSpans.machine]: ALL_PHASES,
  [carStatusSpans.machine]: { competing: { competing: true }, retired: { competing: false }, disqualified: { competing: false }, absent: { competing: false } },
};
