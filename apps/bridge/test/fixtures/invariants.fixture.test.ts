import { expect, it } from 'vitest';
import { InvariantChecker } from '../../../../packages/engine/test/support/invariants.ts';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { replayRunner } from './engine-replay.ts';

describeWithFixture('ttZandvoort', 'engine invariants on TT Zandvoort', () => {
  it('hold on every frame; 15 confirmed laps', async () => {
    const checker = new InvariantChecker();
    const runner = await replayRunner('ttZandvoort', (r) => checker.check(r));
    expect(runner.state.history.laps.filter((l) => l.status === 'confirmed')).toHaveLength(15);
  }, 180_000);
});

describeWithFixture('raceSingapore', 'engine invariants on the Singapore race', () => {
  it('hold on every frame; 20 active cars', async () => {
    const checker = new InvariantChecker();
    const runner = await replayRunner('raceSingapore', (r) => checker.check(r));
    expect(runner.state.cars.filter((c) => c.active)).toHaveLength(20);
  }, 180_000);
});
