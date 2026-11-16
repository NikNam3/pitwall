// Where our car was when (SP4.3d spec §6.5, C43): the one owner of reading our own crossing history (`gaps`' `recent`:
// `at[i]` is when the car passed progress `fromProgress + i`, a hole where none was recorded) both ways, interpolated
// between the two crossings around the asked point. `progressAt` (time → our progress) places `rejoin-ghost`'s ghost;
// `timeAtProgress` (progress → when we were there) gives `rejoin`'s scale and the circle's. Before our first kept
// crossing either answer is `insufficientData`, never NaN.
import { known, unknown, type Known, type SessionTime } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import type { CarCrossings } from './gapper-lines.ts';

const INSUFFICIENT = unknown('insufficientData');

type Crossings = DeepReadonly<CarCrossings>;

/**
 * Our progress in mini-sectors at `t`: interpolated between our two crossings around `t`, our newest progress after
 * our newest crossing. `insufficientData` when `t` lies before our first kept crossing.
 */
export function progressAt(ours: Crossings, t: SessionTime): Known<number> {
  const at = ours.at;
  // `t` is mostly recent: scan back from our newest crossing
  let next = -1;
  for (let i = at.length - 1; i >= 0; i--) {
    const x = at[i];
    if (x === undefined) continue;
    if (x <= t) {
      if (next < 0) return known(ours.fromProgress + i, x);
      const to = at[next] as SessionTime;
      return known(ours.fromProgress + i + ((next - i) * (t - x)) / (to - x), to);
    }
    next = i;
  }
  return INSUFFICIENT;
}

/**
 * When we were at `progress` (mini-sectors), interpolated between our crossings either side of it. `insufficientData`
 * before our first kept crossing and past our newest progress (we never were there).
 */
export function timeAtProgress(ours: Crossings, progress: number): Known<SessionTime> {
  const at = ours.at;
  const offset = progress - ours.fromProgress;
  if (!(offset >= 0) || offset > at.length - 1) return INSUFFICIENT;
  const k = Math.floor(offset);
  let i = k;
  while (i >= 0 && at[i] === undefined) i--;
  if (i < 0) return INSUFFICIENT;
  const from = at[i] as SessionTime;
  if (i === offset) return known(from, from);
  let j = k + 1;
  while (j < at.length && at[j] === undefined) j++;
  if (j >= at.length) return INSUFFICIENT;
  const to = at[j] as SessionTime;
  return known(from + ((offset - i) * (to - from)) / (j - i), to);
}
