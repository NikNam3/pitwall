// The leader's lap at a past frame (SP4.3c Task 6, O10): the as-of form of `gaps`' `leaderProgress`, for the readers
// that place a frame of the projection (a neutralisation's start or end, an incident) on the race's laps.
import type { FrameNumber, LapRecord } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';

/**
 * The leader's lap at `frame` (C26, C45): one more than the most laps any car completed by that frame, the frame itself
 * included, from the projection's laps (a provisional lap and the confirmed one that supersedes it are one lap, C25);
 * lap 1 before any lap is completed.
 */
export function leaderLapAt(laps: readonly DeepReadonly<Pick<LapRecord, 'lapNumber' | 'frame'>>[], frame: FrameNumber): number {
  let completed = 0;
  for (const lap of laps) if (lap.frame <= frame && lap.lapNumber > completed) completed = lap.lapNumber;
  return completed + 1;
}
