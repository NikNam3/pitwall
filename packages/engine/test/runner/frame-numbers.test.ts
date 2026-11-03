// Frame numbers across a flashback (contract C26, C27, C33): the runner's snapshots carry the frame number, a rewind
// restores it and the replayed frames count again, so every fact and span after a rewind has the frame numbers a run
// without the undone frames gives it; the void fact describes the frame number of its target. The registry here is the
// test machines (`test/support/test-machines.ts`), so spans exist whatever else is registered.
import { describe, expect, it, vi } from 'vitest';
import { SessionRunner, type EngineState, type Frame } from '../../src/index.ts';
import { situationOf } from '../../src/situations/run.ts';
import type { DeepReadonly } from '../../src/util/deep-readonly.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { initFor } from '../support/run.ts';
import { after, applyOne, drive, flbk, runAll, STEP, timeline } from '../support/runner.ts';

vi.mock('../../src/situations/index.generated.ts', async () => {
  const { TEST_MACHINES } = await import('../support/test-machines.ts');
  return { MACHINES: TEST_MACHINES };
});

/**
 * Car 0 drives laps beginning at the frame indexes of `lapStarts` and is in the pit lane on the frames of `pits` (`[from,
 * to)` each); `extra` adds events per frame index.
 */
const race = (frames: number, lapStarts: number[], pits: ReadonlyArray<readonly [number, number]>, extra: (i: number) => ReturnType<typeof flbk>[] = () => []): Frame[] => {
  const b = new ScenarioBuilder({ cars: 2, stepMs: STEP }).session({ trackLength: 4000 });
  for (let i = 0; i < frames; i++) {
    for (const details of extra(i)) b.event(details);
    b.frame((d) => {
      drive(lapStarts)(d);
      d.lapData.lapData[0]!.pitStatus = pits.some(([from, to]) => i >= from && i < to) ? 1 : 0;
    });
  }
  return b.build();
};

const noFlbk = (fs: Frame[]) => fs.map((f) => ({ ...f, events: f.events.filter((e) => e.details.code !== 'FLBK') }));

/** The frame numbers of everything readers see: every projected fact's and span's, and the open spans'. */
const frameNumbers = (state: DeepReadonly<EngineState>) => ({
  laps: state.history.laps.map((l) => l.frame),
  crossings: state.history.crossings.map((c) => c.frame),
  events: state.history.events.map((e) => e.frame),
  clock: state.history.clock.map((c) => c.frame),
  spans: Object.fromEntries(Object.entries(state.history.spans).map(([machine, spans]) => [machine, spans.map((s) => [s.carId, s.id, s.startFrame, s.endFrame])])),
  open: Object.fromEntries(Object.entries(situationOf(state).byMachine).map(([machine, spans]) => [machine, spans.map((s) => [s.carId, s.id, s.startFrame])])),
});

/** Car 0's closed `test-car` spans as kind, id and frames. */
const carZero = (state: DeepReadonly<EngineState>) =>
  (state.history.spans['test-car'] ?? []).filter((s) => s.carId === 0).map((s) => [s.kind, s.id, s.startFrame, s.endFrame]);

// original: frames 0..299, laps begin at 100 and 250, car 0 in the pit lane from 150 to 220. The game flashes back to
// frame 200, inside the stop; in the new timeline (frames 201..399) the car leaves at 210, stops again from 260 to 280
// and lap 3 begins at 330.
const scene = () => {
  const original = race(300, [100, 250], [[150, 220]]);
  const fork = race(400, [100, 330], [[150, 210], [260, 280]], (i) => (i === 201 ? [flbk(200)] : []));
  return { original, continuation: after(fork, 201, 300), reference: noFlbk(fork) };
};

describe('frame numbers across a flashback (C26, C27, C33)', () => {
  it("frame numbers after a rewind equal a straight run's", () => {
    const { original, continuation, reference } = scene();
    const rewound = new SessionRunner(initFor(original));
    runAll(rewound, original);
    runAll(rewound, continuation);
    const straight = new SessionRunner(initFor(reference));
    runAll(straight, reference);

    expect(straight.state.frameNumber).toBe(400);
    expect(rewound.state.frameNumber).toBe(straight.state.frameNumber);
    expect(frameNumbers(rewound.state)).toEqual(frameNumbers(straight.state));
    // frame index i is frame number i + 1: the laps end on frames 100 and 330, car 0's pit spans open on 150 and 260
    expect(straight.state.history.laps.map((l) => [l.lapNumber, l.frame])).toEqual([[1, 101], [2, 331]]);
    expect(carZero(straight.state)).toEqual([['track', 0, 1, 151], ['pit', 1, 151, 211], ['track', 2, 211, 261], ['pit', 3, 261, 281]]);
  });

  it('the void fact describes its target’s frame number', () => {
    const { original, continuation } = scene();
    const runner = new SessionRunner(initFor(original));
    runAll(runner, original);
    applyOne(runner, continuation[0]!);
    // restored to frame 200, the last replayed frame: number 201
    expect(runner.state.log.voids.map((v) => [v.target.frameId, v.frame])).toEqual([[200, 201]]);
    expect(runner.state.frameNumber).toBe(202);

    // A target older than the replay window: nothing is replayed, the state is the snapshot's after frame 63 (number 64).
    const laps = Array.from({ length: 9 }, (_, k) => 100 * (k + 1));
    const long = timeline(1000, laps);
    const old = new SessionRunner(initFor(long));
    runAll(old, long);
    applyOne(old, after(timeline(200, [120], (i) => (i === 91 ? [flbk(90)] : [])), 91, 1000)[0]!);
    expect(old.state.log.voids.map((v) => [v.target.frameId, v.frame])).toEqual([[63, 64]]);
    expect(old.state.frameNumber).toBe(65);
  });
});
