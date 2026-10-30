// Per car, per completed lap, the gap to a virtual car at constant pace (spec 6.1).
import type { GapperLines, GapperReference } from '@pitwall/domain';
import { defineTopic } from '../topic-def.ts';

/** The gapper's params: which virtual car the gaps are measured to. */
export type GapperParams = { reference: GapperReference };

export default defineTopic<GapperParams, GapperLines>({
  owner: 'gaps',
  mode: 'state',
  maxHz: 1,
  // a fixed reference takes any lap time, so a moment holds only the leader's and each car's average
  momentParams: (carIds) => [{ reference: { kind: 'leaderAverage' } }, ...carIds.map((carId) => ({ reference: { kind: 'carAverage' as const, carId } }))],
});
