// An incremental unit's output reads the view (contract C31.2, ruling Task 22 round 3): the scheduler hands
// `output(acc, view)` the view it folded the accumulator on.
import { describe, expect, it } from 'vitest';
import type { IncrementalCalculator } from '../../src/index.ts';
import { delta, input, sched } from '../support/scheduler.ts';

/** Folds the laps' count; its output adds the session time of the view it is given. */
const laps: IncrementalCalculator<number, number> = {
  kind: 'incremental',
  id: 'probe.laps',
  reads: ['laps'],
  cadence: 'frame',
  init: (v) => v.history.laps.length,
  update: (acc, d) => acc + (d.after.laps ?? 0) - (d.before.laps ?? 0),
  output: (acc, view) => 1_000 * acc + view.live.sessionTime,
};

describe('the scheduler gives an incremental unit its output on the view (C31.2)', () => {
  it('on init and on every fold: the view of the frame', () => {
    const s = sched([laps]);
    expect(s.run(input(5, ['laps'], delta(2, 2))).outputs.get('probe.laps')).toBe(2_005);
    expect(s.run(input(7, ['laps'], delta(2, 3))).outputs.get('probe.laps')).toBe(3_007);
  });
});
