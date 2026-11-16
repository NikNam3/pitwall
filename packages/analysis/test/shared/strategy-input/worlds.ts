// The DP input's weather worlds as the tests hand them to `dpInputOn` (SP4.3c Task 19, O3b, B5): each `weatherWorlds`
// entry (its `u`, weight and wetness per lap from `start.lap`) with the plain forecast's road in that world (`road`).
import type { StartingPoint } from '@pitwall/domain';
import type { PlainRoad, RoadWorld } from '../../../src/shared/strategy-input/dp-input.ts';

/** One world of weight 1 at the starting point's wetness on every lap, with `road` (default: none). */
export function oneWorld(start: Pick<StartingPoint, 'lap' | 'lapsTotal' | 'wetness'>, road: PlainRoad = new Map()): RoadWorld[] {
  const path = new Float64Array(Math.max(0, start.lapsTotal - start.lap + 1)).fill(start.wetness.wetnessMs);
  return [{ u: 0.5, weight: 1, path, road }];
}
