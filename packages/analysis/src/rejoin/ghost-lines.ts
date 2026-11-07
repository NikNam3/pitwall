// `rejoin.ghostLines` (SP4.2 spec 3.2): per our car and condition, its gapper line (`gapperLines`, shared with
// `gaps.gapper`, C43) over the last `ghostLaps` laps, each point plus the condition's loss; an unknown loss has no line.
import type { GapperReference, GhostLines, PitCondition } from '@pitwall/domain';
import { gapperLines } from '../shared/gapper-lines.ts';
import type { GhostLinesInput } from './index.ts';

const CONDITIONS: readonly PitCondition[] = ['green', 'vsc', 'sc'];

/** Per our car and condition, its gapper line over the last `ghostLaps` laps plus the loss, in `reference`. */
export function ghostLinesOf(input: GhostLinesInput, reference: GapperReference): GhostLines {
  const gapper = gapperLines(input.gaps, reference);
  const lines: GhostLines['lines'] = [];
  for (const carId of input.ourCars) {
    const line = gapper.cars.find((c) => c.carId === carId);
    if (line === undefined) continue;
    const newest = line.points.at(-1);
    const now = line.now.known ? line.now.value : undefined;
    const lastLap = newest?.lap ?? now?.lap;
    if (lastLap === undefined) continue;
    const recent = line.points.filter((p) => p.lap >= lastLap - input.ghostLaps);
    if (now !== undefined && now.lap !== newest?.lap) recent.push(now);
    for (const condition of CONDITIONS) {
      const loss = input.losses[condition];
      if (!loss.known) continue;
      lines.push({ carId, condition, points: recent.map((p) => ({ lap: p.lap, gapMs: p.gapMs + loss.value })) });
    }
  }
  return { lines };
}
