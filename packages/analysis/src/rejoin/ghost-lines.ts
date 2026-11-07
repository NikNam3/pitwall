// `rejoin.ghostLines` (SP4.2 spec 3.2): stub until Task 6.
import type { GapperReference, GhostLines } from '@pitwall/domain';
import type { GhostLinesInput } from './index.ts';

/** Per our car and condition, its gapper line over the last `ghostLaps` laps plus the loss, in `reference`. */
export function ghostLinesOf(_input: GhostLinesInput, _reference: GapperReference): GhostLines {
  throw new Error('not implemented');
}
