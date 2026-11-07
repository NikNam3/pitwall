// Our cars' gapper lines plus each condition's pit loss, over the last laps, in the gap chart's reference (SP4.2 spec 3.2).
import type { GhostLines } from '@pitwall/domain';
import { defineTopic } from '../topic-def.ts';
import type { GapperParams } from './gaps.gapper.ts';

export default defineTopic<GapperParams, GhostLines>({
  owner: 'rejoin',
  mode: 'state',
  maxHz: 4,
  // as gaps.gapper: the leader's and each car's average reference
  momentParams: (carIds) => [{ reference: { kind: 'leaderAverage' } }, ...carIds.map((carId) => ({ reference: { kind: 'carAverage' as const, carId } }))],
});
