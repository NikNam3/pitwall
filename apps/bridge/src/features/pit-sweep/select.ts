// The select of `pitSweep.car` (SP4.3b spec §9.2): the job's output per car to the table of the panel's compound.
// Contract-first stub (C81) until SP4.3b2 Task 8.
import type { PitSweepOutput } from '@pitwall/analysis';
import type { PitSweep } from '@pitwall/domain';

/**
 * No entry for `params.carId` → no data; `compound: 'auto'` → the table of the compound `auto` resolves to (or `auto`'s
 * reason); a compound → its table, or `unknown('notApplicable')` without one. `params` is client input. Stub until Task 8.
 */
export function selectSweep(_out: PitSweepOutput, _params: object): PitSweep | undefined {
  throw new Error('not implemented');
}
