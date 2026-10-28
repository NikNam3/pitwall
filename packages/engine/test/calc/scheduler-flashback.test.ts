import { describe, expect, it } from 'vitest';
import type { Cadence, ChangeTag } from '../../src/index.ts';
import { delta as lapDelta, input, quick, sched } from '../support/scheduler.ts';

// laps and pit stops move together, so one delta serves both cadences
const delta = (before: number, after: number, truncated: boolean) => lapDelta(before, after, truncated, ['laps', 'pitStops']);
const scheduler = (cadence: Cadence, reads: ChangeTag[]) => sched([quick('a', { cadence, reads })]);

describe('Scheduler after a flashback', () => {
  it.each([
    ['lapCompleted', 'laps'],
    ['pitStop', 'pitStops'],
  ] as const)('a truncating delta makes a %s calculator run although nothing was added', (cadence, tag) => {
    const s = scheduler(cadence, [tag]);
    s.run(input(0, [tag], delta(3, 3, false)));
    expect(s.run(input(1, [tag], delta(3, 3, false))).ran).toEqual([]);
    expect(s.run(input(2, [tag], delta(3, 1, true))).ran).toEqual(['a']);
  });
  it('the truncation is consumed by that run: the next quiet frame does not run it again', () => {
    const s = scheduler('lapCompleted', ['laps']);
    s.run(input(0, ['laps'], delta(3, 3, false)));
    s.run(input(1, ['laps'], delta(3, 1, true)));
    expect(s.run(input(2, ['laps'], delta(1, 1, false))).ran).toEqual([]);
  });
});
