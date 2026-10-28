import { describe, expect, it } from 'vitest';
import { CalculatorRegistry, Scheduler, type Calculator, type QuickCalculator, type ChangeTag, type FeedMetricsView, type HistoryDelta } from '../../src/index.ts';

const len = (laps: number) => ({ laps, stints: 0, pitStops: 0, flagPhases: 0, events: 0, miniSectors: 0 });
const delta = (before = 0, after = before): HistoryDelta => ({ before: len(before), after: len(after), truncated: false });
const feed = { framesClosed: 0, incompleteFrames: 0, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0, packetsPerSecond: 0, connected: true, msSinceLastPacket: 0, lossPercent: 0 } as FeedMetricsView;
const input = (t: number, changed: ChangeTag[] = ['timing'], d = delta()) =>
  ({ state: { feedId: 'f1', sessionTime: t, history: {} } as never, changed: new Set(changed), delta: d, feed });
const quick = (id: string, o: Partial<QuickCalculator<unknown>> = {}): Calculator =>
  ({ kind: 'quick', id, reads: ['timing'], cadence: 'frame', compute: (v) => v.state.sessionTime, ...o }) as Calculator;
const sched = (calcs: Calculator[]) => {
  const s = new Scheduler(CalculatorRegistry.build(calcs));
  s.setNeeded(calcs.map((c) => c.id));
  return s;
};

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
