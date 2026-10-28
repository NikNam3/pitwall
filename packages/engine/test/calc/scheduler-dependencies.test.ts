import { describe, expect, it } from 'vitest';
import { delta, input, quick, sched } from '../support/scheduler.ts';

describe('Scheduler dependencies', () => {
  it('a dependent that was not due when its dependency ran picks the change up when it is due', () => {
    const s = sched([quick('a', { reads: ['laps'] }), quick('b', { reads: [{ calculator: 'a' }], cadence: { hz: 2 }, compute: (v) => v.outputs.get('a') })]);
    expect(s.run(input(0)).ran).toEqual(['a', 'b']);
    expect(s.run(input(100, ['laps'])).ran).toEqual(['a']);
    const r = s.run(input(500, ['timing']));
    expect(r.ran).toEqual(['b']);
    expect(r.outputs.get('b')).toBe(100);
  });
  it('the remembered dependency is consumed by the dependent run', () => {
    const s = sched([quick('a', { reads: ['laps'] }), quick('b', { reads: [{ calculator: 'a' }], cadence: 'lapCompleted' })]);
    s.run(input(0));
    s.run(input(1, ['laps'], delta(0, 0)));
    expect(s.run(input(2, ['timing'], delta(0, 1))).ran).toEqual(['b']);
    expect(s.run(input(3, ['timing'], delta(1, 2))).ran).toEqual([]);
  });
  it('dependents of a failing calculator stay blocked, transitively, until it succeeds again', () => {
    let fail = true;
    const s = sched([
      quick('a', { compute: () => { if (fail) throw new Error('boom'); return 1; } }),
      quick('b', { reads: [{ calculator: 'a' }] }),
      quick('c', { reads: [{ calculator: 'b' }] }),
    ]);
    expect(s.run(input(0)).ran).toEqual([]);
    expect(s.run(input(1)).ran).toEqual([]);
    fail = false;
    expect(s.run(input(2)).ran).toEqual(['a', 'b', 'c']);
  });
});
