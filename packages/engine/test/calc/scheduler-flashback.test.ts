import { describe, expect, it } from 'vitest';
import { CalculatorRegistry, Scheduler, type Cadence, type Calculator, type ChangeTag, type FeedMetricsView, type HistoryDelta } from '../../src/index.ts';

const len = (n: number) => ({ laps: n, stints: 0, pitStops: n, flagPhases: 0, events: 0, miniSectors: 0 });
const delta = (before: number, after: number, truncated: boolean): HistoryDelta => ({ before: len(before), after: len(after), truncated });
const feed = { framesClosed: 0, incompleteFrames: 0, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0, packetsPerSecond: 0, connected: true, msSinceLastPacket: 0, lossPercent: 0 } as FeedMetricsView;
const input = (t: number, changed: ChangeTag[], d: HistoryDelta) =>
  ({ state: { feedId: 'f1', sessionTime: t, history: {} } as never, changed: new Set(changed), delta: d, feed });
const scheduler = (cadence: Cadence, reads: ChangeTag[]) => {
  const calc: Calculator = { kind: 'quick', id: 'a', reads, cadence, compute: (v) => v.state.sessionTime };
  const s = new Scheduler(CalculatorRegistry.build([calc]));
  s.setNeeded(['a']);
  return s;
};

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
