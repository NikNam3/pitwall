import { describe, expect, it } from 'vitest';
import { feedId, toSessionTime, type Insight } from '@pitwall/domain';
import { CalculatorRegistry, Scheduler, type Cadence, type ChangeTag, type HistoryDelta } from '../../src/index.ts';
import { delta as lapDelta, input, quick, sched } from '../support/scheduler.ts';

// laps and pit stops move together, so one delta serves both cadences
const delta = (before: number, after: number, rewound: boolean) => lapDelta(before, after, rewound, ['laps', 'pitStops']);
const scheduler = (cadence: Cadence, reads: ChangeTag[]) => sched([quick('a', { cadence, reads })]);
/** A delta of a frame that rewound to `target` (C30). */
const rewoundTo = (target: NonNullable<HistoryDelta['rewound']>): HistoryDelta => ({ ...delta(3, 1, false), rewound: target });

describe('Scheduler after a flashback', () => {
  it.each([
    ['lapCompleted', 'laps'],
    ['pitStop', 'pitStops'],
  ] as const)('a rewinding delta makes a %s calculator run although nothing was added', (cadence, tag) => {
    const s = scheduler(cadence, [tag]);
    s.run(input(0, [tag], delta(3, 3, false)));
    expect(s.run(input(1, [tag], delta(3, 3, false))).ran).toEqual([]);
    expect(s.run(input(2, [tag], delta(3, 1, true))).ran).toEqual(['a']);
  });
  it('the rewind is consumed by that run: the next quiet frame does not run it again', () => {
    const s = scheduler('lapCompleted', ['laps']);
    s.run(input(0, ['laps'], delta(3, 3, false)));
    s.run(input(1, ['laps'], delta(3, 1, true)));
    expect(s.run(input(2, ['laps'], delta(1, 1, false))).ran).toEqual([]);
  });
  // Task 2 review F2: everything after the earlier target changed since the calculator last ran.
  it('two rewinds before a calculator runs keep the earliest target', () => {
    const s = sched([quick('a', { cadence: { hz: 1 }, compute: (v) => v.delta.rewound })]);
    s.run(input(0));
    expect(s.run({ ...input(100), delta: rewoundTo({ frameId: 5, at: toSessionTime(0.08) }) }).ran).toEqual([]);
    expect(s.run({ ...input(200), delta: rewoundTo({ frameId: 10, at: toSessionTime(0.16) }) }).ran).toEqual([]);
    const { ran, outputs } = s.run(input(1000));
    expect([ran, outputs.get('a')]).toEqual([['a'], { frameId: 5, at: 80 }]);
  });
  it('two rewinds, the later one to the earlier target, keep that one', () => {
    const s = sched([quick('a', { cadence: { hz: 1 }, compute: (v) => v.delta.rewound })]);
    s.run(input(0));
    s.run({ ...input(100), delta: rewoundTo({ frameId: 10, at: toSessionTime(0.16) }) });
    s.run({ ...input(200), delta: rewoundTo({ frameId: 5, at: toSessionTime(0.08) }) });
    expect(s.run(input(1000)).outputs.get('a')).toEqual({ frameId: 5, at: 80 });
  });
});

describe('Scheduler bookkeeping (Snapshotable, C27)', () => {
  const insight = (key: string): Insight => ({ key, severity: 'info', category: 'race', feedId: feedId('f1'), kind: key, params: {}, raisedAt: toSessionTime(0) });
  /** Runs at 2 Hz and returns the session time; raises `late` from 1000 ms on and `early` before it. */
  const probe = () => sched([quick('a', { cadence: { hz: 2 }, insights: (t) => [insight((t as number) >= 1000 ? 'late' : 'early')] })]);

  it('restore(snapshot()) brings back the run times, the previous outputs and the active insights', () => {
    const s = probe();
    s.run(input(0));
    s.run(input(600));
    const saved = s.snapshot();
    expect(s.activeInsights.map((i) => [i.key, i.raisedAt])).toEqual([['early', 0]]);
    s.run(input(1100));
    expect(s.activeInsights.map((i) => i.key)).toEqual(['late']);
    s.restore(saved);
    expect(s.activeInsights.map((i) => [i.key, i.raisedAt])).toEqual([['early', 0]]);
    // the last run was at 600 ms again: due at 1100, not before, and `early` is still the one to resolve
    expect(s.run(input(1000)).ran).toEqual([]);
    expect(s.run(input(1100)).insights).toEqual([{ type: 'resolved', key: 'early', at: 1100 }, { type: 'raised', insight: { ...insight('late'), raisedAt: 1100 } }]);
  });
  it('a snapshot is not changed by later runs', () => {
    const s = probe();
    s.run(input(0));
    const saved = s.snapshot();
    const copy = structuredClone(saved);
    s.run(input(1100));
    expect(saved).toEqual(copy);
  });
});

// The bookkeeping's snapshots share the outputs (C27), so no unit may change an output after returning it. Tests make
// a breach fail: the bridge sets the option from `PITWALL_FREEZE_OUTPUTS`, the engine's test supports pass it.
describe('Scheduler freezeOutputs', () => {
  /** Returns a fresh object each run and, on its next run, changes the one it returned before. */
  const mutating = () => {
    let last: { laps: number[] } | undefined;
    return quick('m', { compute: () => { last?.laps.push(1); last = { laps: [] }; return last; } });
  };
  const secondRunErrors = (freezeOutputs: boolean) => {
    const s = new Scheduler(CalculatorRegistry.build([mutating()]), { freezeOutputs });
    s.setNeeded(['m']);
    s.run(input(0));
    return s.run(input(16)).errors;
  };

  it('with freezeOutputs a unit that mutates its returned output throws; without it, it does not', () => {
    const frozen = secondRunErrors(true);
    expect(frozen.map((e) => e.id)).toEqual(['m']);
    expect(frozen[0]!.error).toBeInstanceOf(TypeError);
    expect(secondRunErrors(false)).toEqual([]);
  });
});
