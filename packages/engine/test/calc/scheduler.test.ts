import { describe, expect, it } from 'vitest';
import { CalculatorRegistry, Scheduler, type Calculator, type ChangeTag, type FeedMetricsView, type HistoryDelta, type IncrementalCalculator, type QuickCalculator } from '../../src/index.ts';

const len = (laps = 0) => ({ laps, stints: 0, pitStops: 0, flagPhases: 0, events: 0, miniSectors: 0 });
const delta = (b = 0, a = b, truncated = false): HistoryDelta => ({ before: len(b), after: len(a), truncated });
const feed = { framesClosed: 0, incompleteFrames: 0, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0, packetsPerSecond: 0, connected: true, msSinceLastPacket: 0, lossPercent: 0 } as FeedMetricsView;
const input = (t: number, changed: ChangeTag[] = ['timing'], d = delta(), laps = d.after.laps) =>
  ({ state: { feedId: 'f1', sessionTime: t, history: { laps: new Array(laps).fill({}) } } as never, changed: new Set(changed), delta: d, feed });
const quick = (id: string, o: Partial<QuickCalculator<unknown>> = {}): Calculator => ({ kind: 'quick', id, reads: ['timing'], cadence: 'frame', compute: (v) => v.state.sessionTime, ...o } as Calculator);
const sched = (calcs: Calculator[], needed = calcs.map((c) => c.id)) => { const s = new Scheduler(CalculatorRegistry.build(calcs)); s.setNeeded(needed); return s; };

describe('Scheduler', () => {
  it('{ hz: 2 } runs at most every 500 ms of session time', () => {
    const s = sched([quick('a', { cadence: { hz: 2 } })]);
    expect([0, 100, 499, 500, 600, 1000].map((t) => s.run(input(t)).ran)).toEqual([['a'], [], [], ['a'], [], ['a']]);
  });
  it('runs on first activation, then only when affected', () => {
    const s = sched([quick('a', { reads: ['laps'] })]);
    expect(s.run(input(0, ['timing'])).ran).toEqual(['a']);
    expect(s.run(input(16, ['timing'])).ran).toEqual([]);
    expect(s.run(input(32, ['laps'])).ran).toEqual(['a']);
  });
  it('remembers changes from frames where it was not due', () => {
    const s = sched([quick('a', { reads: ['laps'], cadence: { hz: 2 } })]);
    s.run(input(0)); s.run(input(100, ['laps']));
    expect(s.run(input(500, ['timing'])).ran).toEqual(['a']);
  });
  it('event cadences', () => {
    const lap = sched([quick('l', { reads: ['laps'], cadence: 'lapCompleted' })]); lap.run(input(0));
    expect(lap.run(input(1, ['laps'], delta(3, 3))).ran).toEqual([]);
    expect(lap.run(input(2, ['laps'], delta(3, 4))).ran).toEqual(['l']);
    const ses = sched([quick('s', { reads: ['session', 'timing'], cadence: 'sessionChange' })]); ses.run(input(0));
    expect(ses.run(input(1, ['timing'])).ran).toEqual([]);
    expect(ses.run(input(2, ['session'])).ran).toEqual(['s']);
  });
  it('runs needed calculators and their transitive dependencies only', () => {
    const s = sched([quick('a'), quick('b', { reads: [{ calculator: 'a' }] }), quick('c', { reads: [{ calculator: 'b' }] }), quick('d')], ['c']);
    expect(s.run(input(0)).ran).toEqual(['a', 'b', 'c']);
  });
  it('a dependency that ran makes its dependents affected; outputs persist', () => {
    const s = sched([quick('a', { reads: ['laps'] }), quick('b', { reads: [{ calculator: 'a' }], compute: (v) => v.outputs.get('a') })]);
    s.run(input(0));
    expect(s.run(input(16, ['timing'])).ran).toEqual([]);
    const r = s.run(input(32, ['laps']));
    expect(r.ran).toEqual(['a', 'b']);
    expect(r.outputs).toEqual(new Map([['a', 32], ['b', 32]]));
  });
  it('a throwing calculator: errors entry, calculatorError insight, dependents skipped, others run', () => {
    let fail = true;
    const s = sched([quick('a', { compute: () => { if (fail) throw new Error('boom'); return 1; } }), quick('b', { reads: [{ calculator: 'a' }] }), quick('c')]);
    const r = s.run(input(5));
    expect(r.ran).toEqual(['c']);
    expect(r.errors.map((e) => e.id)).toEqual(['a']);
    expect(r.outputs.has('a')).toBe(false);
    expect(r.insights).toEqual([{ type: 'raised', insight: { key: 'system.calculatorError:a', severity: 'advisory', category: 'system', feedId: 'f1', kind: 'system.calculatorError', params: { calculatorId: 'a', message: 'boom' }, raisedAt: 5 } }]);
    fail = false;
    const r2 = s.run(input(6));
    expect(r2.ran).toEqual(['a', 'b', 'c']);
    expect(r2.insights).toEqual([{ type: 'resolved', key: 'system.calculatorError:a', at: 6 }]);
  });
  it('calculator insights go through the insight book with prev output', () => {
    const seen: Array<[unknown, unknown]> = [];
    const s = sched([quick('a', { insights: (out, prev) => { seen.push([out, prev]); return [{ key: 'k', severity: 'info', category: 'race', feedId: 'f1', kind: 'k', params: {}, raisedAt: 0 }] as never; } })]);
    expect(s.run(input(1)).insights).toHaveLength(1);
    expect(s.run(input(2)).insights).toEqual([]);
    expect(seen).toEqual([[1, undefined], [2, 1]]);
  });

  describe('incremental', () => {
    const calls: string[] = [];
    const counter = (o: Partial<IncrementalCalculator<number, number>> = {}): Calculator => ({
      kind: 'incremental', id: 'n', reads: ['laps'], cadence: 'frame',
      init: (v) => { calls.push('init'); return v.state.history.laps.length; },
      update: (acc: number, d) => { calls.push(`update ${d.before.laps}->${d.after.laps}`); return acc + d.after.laps - d.before.laps; },
      output: (acc) => acc, ...o,
    } as Calculator);
    it('init on first run, update with delta, re-init on truncation and after reset()', () => {
      calls.length = 0;
      const s = sched([counter()]);
      expect(s.run(input(0, ['laps'], delta(2, 2))).outputs.get('n')).toBe(2);
      expect(s.run(input(1, ['laps'], delta(2, 3))).outputs.get('n')).toBe(3);
      expect(s.run(input(2, ['laps'], delta(3, 1, true))).outputs.get('n')).toBe(1);
      s.reset();
      s.run(input(3, ['laps'], delta(1, 1)));
      expect(calls).toEqual(['init', 'update 2->3', 'init', 'init']);
    });
    it('merges deltas across runs it skipped', () => {
      calls.length = 0;
      const s = sched([counter({ cadence: { hz: 2 } })]);
      s.run(input(0, ['laps'], delta(0, 0)));
      s.run(input(100, ['laps'], delta(0, 2)));
      expect(s.run(input(500, ['laps'], delta(2, 3))).outputs.get('n')).toBe(3);
      expect(calls).toEqual(['init', 'update 0->3']);
    });
  });
});
