// A generated race as a source `projectionAsOf` can cut (SP4.3a plan Task 9, R2): the generator's views keep no append
// frames (`appendedAt`), so this gives the race's final projection the append frames its views show at the given frames:
// an entry counts as appended on the first given frame whose view holds it. A cut at any given frame is then exactly
// that frame's view; a cut between given frames is not tested.
import type { FrameNumber } from '@pitwall/domain';
import { projectionLengths, type MembershipSource } from '@pitwall/engine/readers';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';

/** The race's final projection and situation with append frames exact at `frames` (the race's last frame is added). */
export function withAppendFrames(race: BuilderRace, frames: readonly FrameNumber[]): MembershipSource {
  const at = [...new Set([...frames, race.lastFrame])].sort((a, b) => a - b);
  const lengths: Array<Partial<Record<string, number>>> = at.map((frame) => projectionLengths(race.viewAt(frame).history));
  const last = race.viewAt(race.lastFrame);
  const appendedAt: Record<string, FrameNumber[]> = {};
  for (const [list, n] of Object.entries(projectionLengths(last.history))) {
    if (n === undefined || n === 0) continue;
    const of: FrameNumber[] = [];
    let k = 0;
    for (let i = 0; i < n; i++) {
      while ((lengths[k]![list] ?? 0) <= i) k++;
      of.push(at[k]!);
    }
    appendedAt[list] = of;
  }
  return { history: { ...last.history, appendedAt }, situation: last.situation };
}
