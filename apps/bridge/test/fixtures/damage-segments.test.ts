// A wing change in the garage on real data, on practice-wing-change (car 19's front-right wing 100 % to 0 % at
// 616.783 s); facts in fixtures/index.json. The engine plus the damage calculator.
import { describe, expect, it } from 'vitest';
import { DAMAGE, damageCalculator, type DamageOutput } from '@pitwall/analysis';
import type { CarId } from '@pitwall/domain';
import { replayRunner, replayScheduled } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

const FILE = 'practice-wing-change.pwrec.gz';
const CAR = 19 as CarId;
const CHANGE_AT = 616_783;

/** The session time and car 19's front-right wing, of each damage run over the segment. */
async function damageRuns(): Promise<{ at: number; frontRightWingPct: number | undefined }[]> {
  const runs: { at: number; frontRightWingPct: number | undefined }[] = [];
  await replayScheduled(segmentPath(FILE), [damageCalculator], ({ state }, scheduled) => {
    if (!scheduled.ran.includes(DAMAGE)) return;
    const car = (scheduled.outputs.get(DAMAGE) as DamageOutput)[CAR];
    if (car === undefined) return;
    runs.push({
      at: state.sessionTime,
      frontRightWingPct: car.parts.known ? car.parts.value.frontRightWingPct : undefined,
    });
  });
  return runs;
}

describe('a wing change on real data', () => {
  it('practice-wing-change: the change is one damageChange of frontRightWingPct from 100 to 0', async () => {
    const { state } = await replayRunner(segmentPath(FILE));
    const changes = state.history.events.filter((e) => e.kind === 'damageChange' && e.carId === CAR);
    expect(changes).toEqual([{ at: CHANGE_AT, kind: 'damageChange', carId: CAR, params: { part: 'frontRightWingPct', fromPct: 100, toPct: 0 } }]);
  });

  it('practice-wing-change: the damage state shows the front-right wing at 100 on the last run before the change and at 0 from it on', async () => {
    const runs = await damageRuns();
    const first = runs.findIndex((r) => r.at >= CHANGE_AT);
    expect(first).toBeGreaterThan(0);
    expect(runs[first - 1]!.frontRightWingPct).toBe(100);
    expect(runs.slice(first).map((r) => r.frontRightWingPct)).toEqual(runs.slice(first).map(() => 0));
  });
});
