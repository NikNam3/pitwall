import { feedId } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CalculatorRegistry,
  Scheduler,
  SessionRunner,
  type Calculator,
  type CalculatorId,
  type Frame,
  type IncrementalCalculator,
  type QuickCalculator,
} from '../../src/index.ts';
import { IDLE_FEED } from '../helpers/incremental.ts';
import { arbRace, raceFrames } from '../support/arb-race.ts';
import { input, quick, sched } from '../support/scheduler.ts';

// Quick and incremental calculators over real frames: every frame, a rate, an event cadence and a dependent.
const lapCount: IncrementalCalculator<number, number> = {
  kind: 'incremental', id: 'lapCount', reads: ['laps'], cadence: 'frame',
  init: (v) => v.state.history.laps.length,
  update: (acc, d) => acc + d.after.laps - d.before.laps,
  output: (acc) => acc,
};
const calcs = (): Calculator[] => [
  { kind: 'quick', id: 'clock', reads: ['timing'], cadence: 'frame', compute: (v) => v.state.sessionTime } as QuickCalculator<number>,
  { kind: 'quick', id: 'slow', reads: ['timing'], cadence: { hz: 2 }, compute: (v) => v.state.sessionTime } as QuickCalculator<number>,
  lapCount,
  { kind: 'quick', id: 'sum', reads: [{ calculator: 'clock' }, { calculator: 'lapCount' }], cadence: 'frame',
    compute: (v) => (v.outputs.get('clock') as number) + (v.outputs.get('lapCount') as number) } as QuickCalculator<number>,
];
const make = (onCalculatorRun?: <T>(id: CalculatorId, run: () => T) => T) => {
  const s = new Scheduler(CalculatorRegistry.build(calcs()), onCalculatorRun === undefined ? undefined : { onCalculatorRun });
  s.setNeeded(['sum', 'slow']);
  return s;
};
const runnerFor = (frames: Frame[]) => new SessionRunner({ feedId: feedId('test'), sessionUid: frames[0]!.sessionUid, session: frames[0]!.session! });

describe('Scheduler onCalculatorRun', () => {
  it('sees each due calculator once per run (twice for an incremental: update or init, then output), and outputs match a scheduler without the hook', () => {
    fc.assert(
      fc.property(arbRace, (p) => {
        const { frames } = raceFrames(p);
        const calls: CalculatorId[] = [];
        const hooked = make((id, run) => { calls.push(id); return run(); });
        const plain = make();
        const ra = runnerFor(frames);
        const rb = runnerFor(frames);
        for (const f of frames) {
          const a = ra.apply(f);
          const b = rb.apply(f);
          calls.length = 0;
          const withHook = hooked.run({ state: a.state, changed: a.changed, delta: a.delta, feed: IDLE_FEED, config: {} });
          const without = plain.run({ state: b.state, changed: b.changed, delta: b.delta, feed: IDLE_FEED, config: {} });
          expect(withHook).toEqual(without);
          for (const id of ['clock', 'slow', 'sum']) expect(calls.filter((c) => c === id).length).toBe(withHook.ran.includes(id) ? 1 : 0);
          expect(calls.filter((c) => c === 'lapCount').length).toBe(withHook.ran.includes('lapCount') ? 2 : 0);
          expect(calls.length).toBe(withHook.ran.reduce((n, id) => n + (id === 'lapCount' ? 2 : 1), 0));
        }
      }),
      { numRuns: 15 },
    );
  });

  it('calls init and update of an incremental calculator through the hook, and output after them', () => {
    const seen: string[] = [];
    const s = make((id, run) => { seen.push(id); return run(); });
    const frames = raceFrames({ cars: 2, frames: 60, speeds: [30, 30, 30, 30, 30, 30], jitter: [0], truncation: [0], flashback: undefined }).frames;
    const r = runnerFor(frames);
    for (const f of frames) { const x = r.apply(f); s.run({ state: x.state, changed: x.changed, delta: x.delta, feed: IDLE_FEED, config: {} }); }
    expect(seen.filter((id) => id === 'lapCount').length).toBeGreaterThanOrEqual(2);
    expect(seen.filter((id) => id === 'lapCount').length % 2).toBe(0);
  });

  it('the hook receives the calculator work as a thunk and its return value is the calculator result', () => {
    const s = new Scheduler(CalculatorRegistry.build([quick('a'), quick('b', { compute: () => 'real' })]), {
      onCalculatorRun: <T,>(id: CalculatorId, run: () => T): T => (id === 'a' ? (99 as T) : run()),
    });
    s.setNeeded(['a', 'b']);
    const r = s.run(input(7));
    expect(r.outputs).toEqual(new Map<string, unknown>([['a', 99], ['b', 'real']]));
  });

  it('an exception thrown inside the run propagates through the hook and is reported as a calculator error', () => {
    const s = new Scheduler(CalculatorRegistry.build([quick('a', { compute: () => { throw new Error('boom'); } }), quick('b')]), {
      onCalculatorRun: (_id, run) => run(),
    });
    s.setNeeded(['a', 'b']);
    const r = s.run(input(1));
    expect(r.ran).toEqual(['b']);
    expect(r.errors.map((e) => e.id)).toEqual(['a']);
  });

  it('without the option behaves as before', () => {
    expect(sched([quick('a')]).run(input(3)).outputs).toEqual(new Map([['a', 3]]));
  });
});
