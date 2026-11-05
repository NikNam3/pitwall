// C25: `gaps` gets the current crossings through the domain's helpers (`foldCurrentCrossing` into a `CrossingIndex`, or
// `currentCrossings`), never by its own matching. The helpers are wrapped, not replaced: every result stays the same.
import type * as domain from '@pitwall/domain';
import { carId, currentCrossings, foldCurrentCrossing } from '@pitwall/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crossings } from '../../../../test-support/builders/index.ts';
import { deltaOf, gaps, guarded, restartPass, run, viewOf } from './race.ts';

vi.mock('@pitwall/domain', async (importOriginal) => {
  const real = await importOriginal<typeof domain>();
  return { ...real, foldCurrentCrossing: vi.fn(real.foldCurrentCrossing), currentCrossings: vi.fn(real.currentCrossings) };
});

const fold = vi.mocked(foldCurrentCrossing);
const current = vi.mocked(currentCrossings);
/** How often `gaps` went through either helper. */
const helperCalls = () => fold.mock.calls.length + current.mock.calls.length;

/** Car 0 in practice: lap 1, an earlier pass of lap 2 to segment 30, then lap 2 again from segment 0 to segment 10. */
const before = [...crossings(carId(0), 1, 90_000, 0), ...crossings(carId(0), 2, 90_000, 90_000).slice(0, 31)];
const history = [...before, ...restartPass(before, 0, 2, 90_000, 200_000, 10)];

describe('gaps reads the current crossings through the domain helpers (C25)', () => {
  beforeEach(() => {
    fold.mockClear();
    current.mockClear();
  });

  it('init over a history with a garage restart goes through foldCurrentCrossing or currentCrossings', () => {
    run(viewOf(history, { kind: 'practice' }));
    expect(helperCalls()).toBeGreaterThan(0);
  });

  it('an update that brings the restarted crossings goes through the helpers too', () => {
    const early = viewOf(before, { kind: 'practice' });
    const acc = gaps.init(guarded(early));
    fold.mockClear();
    current.mockClear();
    const full = viewOf(history, { kind: 'practice' });
    gaps.update(acc, deltaOf(early, full), guarded(full));
    expect(helperCalls()).toBeGreaterThan(0);
  });
});
