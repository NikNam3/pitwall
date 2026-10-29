import { expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { replayState } from './engine-replay.ts';

/** A whole recording through the engine takes about a minute alone and much longer while `pnpm check` runs every suite. */
const WHOLE_RECORDING_MS = 300_000;

describeWithFixture('raceSingapore', 'grid positions from the Singapore race', () => {
  // the game sends m_gridPosition from 0 (RUSSELL on pole is 0) and m_carPosition from 1
  it('count from 1 like the positions: the grid is P1 to P20, and the field gained as many places as it lost', async () => {
    const st = await replayState('raceSingapore');
    const cars = st.cars.filter((c) => c.active);
    expect(cars.map((c) => c.timing.gridPosition).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(cars.reduce((sum, c) => sum + c.timing.gridPosition - c.timing.position, 0)).toBe(0);
    // at 63.3 s on lap 1: RUSSELL (4) leads from pole, STROLL (1) P10 -> P9, HADJAR (17) P9 -> P10, SAINZ (2) P13 -> P11
    const gained = (id: number) => st.cars[id]!.timing.gridPosition - st.cars[id]!.timing.position;
    expect([4, 1, 17, 2].map(gained)).toEqual([0, 1, -1, 2]);
  }, WHOLE_RECORDING_MS);
});
