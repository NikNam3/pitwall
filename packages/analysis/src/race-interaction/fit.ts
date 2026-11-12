// The pass curve's fit (SP4.3a spec 5.4): a prior curve refined by following episodes with shrinkage.
import type { PassCurve } from '@pitwall/domain';
import type { FollowingEpisode } from './episodes.ts';

/** `prior` refined by `episodes`, the prior weighing as `shrinkEpisodes` episodes; its cap and wet factor stay the prior's. */
export function fitPassCurve(_episodes: readonly FollowingEpisode[], _prior: PassCurve, _shrinkEpisodes: number): PassCurve {
  throw new Error('not implemented');
}
