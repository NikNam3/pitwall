// Rewind exactness (C33): after a flashback the projection, every calculator output and the insights equal those of a
// run that never received the undone frames. Builder races with random flashbacks (`arb-race`), run through a
// `SessionRunner` with a `Scheduler` attached (C27: its bookkeeping rewinds with the runner), over calculators of every
// kind and cadence: quick every frame, quick at a rate, incremental every frame, incremental on a completed lap. The
// insight changes are kept as a publisher keeps them (C30, C32): with the frame that produced them, the changes after
// a rewind's target dropped.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { feedId, toSessionTime, type CarId, type Insight } from '@pitwall/domain';
import {
  CalculatorRegistry,
  Scheduler,
  SessionRunner,
  type Calculator,
  type Frame,
  type IncrementalCalculator,
  type InsightChange,
  type QuickCalculator,
} from '../../src/index.ts';
import { carsInSessionOf } from '../../src/situations/car-status/in-session.ts';
import { IDLE_FEED } from '../helpers/incremental.ts';
import { arbRace, raceFrames } from '../support/arb-race.ts';
import { initFor } from '../support/run.ts';
import { inputOf } from '../support/scheduler.ts';

const F = feedId('test');
const insight = (key: string, params: Insight['params'] = {}): Insight => ({ key, severity: 'info', category: 'race', feedId: F, kind: key.split(':')[0]!, params, raisedAt: toSessionTime(0) });

/** Laps in the projection per car; raises `laps:<car>` while a car has two or more. */
const lapsPerCar: QuickCalculator<Record<number, number>> = {
  kind: 'quick', id: 'probe.lapsPerCar', reads: ['laps'], cadence: 'frame',
  compute: (v) => {
    const out: Record<number, number> = {};
    for (const l of v.history.laps) out[l.carId] = (out[l.carId] ?? 0) + 1;
    return out;
  },
  insights: (out) => Object.entries(out).flatMap(([car, n]) => (n >= 2 ? [insight(`laps:${car}`)] : [])),
};

/**
 * The race order of the cars in the session (car-status's, Task 24) at 4 Hz; raises `leader:<car>` for the car in P1, so
 * a change of leader resolves one and raises another.
 */
const order: QuickCalculator<CarId[]> = {
  kind: 'quick', id: 'probe.order', reads: ['timing', 'spans:car-status'], cadence: { hz: 4 },
  compute: (v) => {
    const inSession = new Set(carsInSessionOf(v.situation.byMachine['car-status']));
    return v.live.cars.filter((c) => inSession.has(c.id)).sort((a, b) => a.timing.position - b.timing.position).map((c) => c.id);
  },
  insights: (out) => (out[0] === undefined ? [] : [insight(`leader:${out[0]}`)]),
};

/** Mini-sector crossings per car, folded every frame; raises `crossings:<car>` from the 20th on. */
const crossings: IncrementalCalculator<Record<number, number>, Record<number, number>> = {
  kind: 'incremental', id: 'probe.crossings', reads: ['miniSectors'], cadence: 'frame',
  init: (v) => crossings.update({}, { before: { crossings: 0 }, after: { crossings: v.history.crossings.length } }, v),
  update: (acc, d, v) => {
    const next = { ...acc };
    for (const c of v.history.crossings.slice(d.before.crossings ?? 0, d.after.crossings ?? 0)) next[c.carId] = (next[c.carId] ?? 0) + 1;
    return next;
  },
  output: (acc) => acc,
  insights: (out) => Object.entries(out).flatMap(([car, n]) => (n >= 20 ? [insight(`crossings:${car}`, { n: 20 })] : [])),
};

/** The sum of the lap times per car, folded on each completed lap. */
const lapTimes: IncrementalCalculator<Record<number, number>, Record<number, number>> = {
  kind: 'incremental', id: 'probe.lapTimes', reads: ['laps'], cadence: 'lapCompleted',
  init: (v) => lapTimes.update({}, { before: { laps: 0 }, after: { laps: v.history.laps.length } }, v),
  update: (acc, d, v) => {
    const next = { ...acc };
    for (const l of v.history.laps.slice(d.before.laps ?? 0, d.after.laps ?? 0)) next[l.carId] = (next[l.carId] ?? 0) + l.lapTimeMs;
    return next;
  },
  output: (acc) => acc,
};

const CALCULATORS = [lapsPerCar, order, crossings, lapTimes] as Calculator[];

/** A run of `frames`: the runner's projection, the last outputs, the active insights and the insight changes it keeps. */
function run(frames: Frame[]) {
  const scheduler = new Scheduler(CalculatorRegistry.build(CALCULATORS), { freezeOutputs: true });
  scheduler.setNeeded(CALCULATORS.map((c) => c.id));
  const runner = new SessionRunner(initFor(frames), { attach: scheduler });
  let outputs: ReadonlyMap<string, unknown> = new Map();
  let kept: Array<{ frameId: number; change: InsightChange }> = [];
  for (const frame of frames) {
    runner.apply(frame, (r, applied) => {
      const target = r.delta.rewound;
      // The old mechanisms that still rewrite the log in place (the situation tracker's, target frame -1 until Task 9)
      // append no void fact: they undo no frame, so they drop no change.
      if (target !== undefined && target.frameId >= 0) kept = kept.filter((k) => k.frameId <= target.frameId);
      const input = inputOf(r, { feed: IDLE_FEED });
      const scheduled = scheduler.run(input);
      outputs = scheduled.outputs;
      kept.push(...scheduled.insights.map((change) => ({ frameId: applied.frameId, change })));
    });
  }
  return { projection: runner.state.history, outputs, active: scheduler.activeInsights, changes: kept.map((k) => k.change) };
}

describe('rewind exactness (C33)', () => {
  it('the projection and every calculator output and insight equal a run that never received the undone frames', () => {
    fc.assert(
      fc.property(arbRace.filter((p) => p.flashback !== undefined), (p) => {
        const { frames, reference } = raceFrames(p);
        const a = run(frames);
        const b = run(reference);
        expect(a.projection).toEqual(b.projection);
        expect(a.outputs).toEqual(b.outputs);
        expect(a.active).toEqual(b.active);
        expect(a.changes).toEqual(b.changes);
      }),
      { numRuns: 40 },
    );
  });
});
