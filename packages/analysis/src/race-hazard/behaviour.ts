// What `race-hazard` does per situation (contract C14, C43, C44; SP4.3b spec §5.2): one row per kind of every
// sub-machine it reads. The machine decided the situation; the unit only looks up the rows of the spans open now.
import type { MachineId } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/**
 * `table`: the table's chances from the leader's current lap; `fromLapOne`: before the start, the chances from lap 1;
 * `active`: a neutralisation is out, its laps left and no start while it lasts; `notApplicable`: no hazard (C14, or the
 * race over or stopped).
 */
export type RaceHazardEffect = 'table' | 'fromLapOne' | 'active' | 'notApplicable';

export const RACE_HAZARD_BEHAVIOUR: BehaviourTable<RaceHazardEffect> = {
  'weekend-phase': { practice: 'notApplicable', qualifying: 'notApplicable', race: 'table', none: 'notApplicable' },
  'session-phase-race': {
    grid: 'fromLapOne',
    formation: 'fromLapOne',
    startLights: 'fromLapOne',
    racing: 'table',
    neutralised: 'active',
    suspended: 'notApplicable',
    finished: 'notApplicable',
    postSession: 'notApplicable',
  },
};

/** The row of `machine`'s span kind `kind`; a kind without a row is a bug in the table (C3): it throws. */
export function rowOf(machine: MachineId, kind: string): RaceHazardEffect {
  const byKind = RACE_HAZARD_BEHAVIOUR[machine];
  if (byKind === undefined || !Object.hasOwn(byKind, kind)) throw new Error(`behaviour table: no row for ${machine} ${kind}`);
  return byKind[kind] as RaceHazardEffect;
}
