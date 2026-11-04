// Step 2 builds and compares each frame's spans once (Task PERF; contract C9, C10, C40): on a 20-car race built by the
// `ScenarioBuilder`, `step` asks each registered sub-machine for its open spans at most once per frame (step 2's
// `spans:<id>` tag, the situation step 3 and the projection read, the weekend phase), and the cars in the session are
// worked out from car-status's spans at most once per frame outside the sub-machines' own steps (the recorders, the
// flag phases). Counted by spies on each machine's `openSpans` and on the exported `carsInSessionOf`, never by a timer.
// A call made inside a sub-machine's own `step` (session-phase reads its upstream car-status, C9) is that sub-machine's
// logic and is not counted. Measured before the fix (fb474ec): 3 `openSpans` calls per machine per frame, 5 for
// weekend-phase (about 3.2 on average on practiceZandvoortOnline), and 5 `carsInSessionOf` calls on every frame.
//
// Not counted here: the nodes the `spans:<id>` tag check compares. `samePlain` recurses inside `run.ts`, so a spy on
// its export sees no inner call; counting them needs a source seam (a visit counter or a stats hook), which the test
// phase may not add. The identity property (`invariants.property.test.ts`, an unchanged span is the same object, also
// checked here on the 20-car race) is what lets the check stop at the first node of an unchanged span.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MachineId } from '@pitwall/domain';
import { initialState, step, type Frame } from '../../src/index.ts';
import * as inSession from '../../src/situations/car-status/in-session.ts';
import { MACHINES } from '../../src/situations/index.generated.ts';
import { situationOf } from '../../src/situations/run.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { identityProblems } from '../support/machine-invariants.ts';
import { initFor } from '../support/run.ts';

const CARS = 20;
const FRAMES = 300;

/** 20 cars driving down the track, each LapData a little further on: a race alone in its weekend (the builder's default). */
const raceFrames = (): Frame[] =>
  new ScenarioBuilder({ cars: CARS })
    .frames(FRAMES, (f, i) => {
      f.lapData.lapData.forEach((car, index) => {
        car.lapDistance = 100 + index * 50 + i * 1.5;
        car.totalDistance = car.lapDistance;
      });
    })
    .build();

type Counts = { openSpans: Map<MachineId, number>; carsInSession: number };

/**
 * Runs the frames through `step` and returns each frame's counts: `openSpans` calls per machine, and `carsInSessionOf`
 * calls made outside every sub-machine's own `step`.
 */
const countWork = (frames: Frame[]) => {
  const state = initialState(initFor(frames));
  let counts: Counts = { openSpans: new Map(), carsInSession: 0 };
  let inMachineStep = 0;
  for (const machine of MACHINES) {
    const openSpans = machine.openSpans.bind(machine);
    vi.spyOn(machine, 'openSpans').mockImplementation((open) => {
      counts.openSpans.set(machine.id, (counts.openSpans.get(machine.id) ?? 0) + 1);
      return openSpans(open);
    });
    const machineStep = machine.step.bind(machine);
    vi.spyOn(machine, 'step').mockImplementation((open, input) => {
      inMachineStep += 1;
      try {
        return machineStep(open, input);
      } finally {
        inMachineStep -= 1;
      }
    });
  }
  const carsInSessionOf = inSession.carsInSessionOf;
  vi.spyOn(inSession, 'carsInSessionOf').mockImplementation((spans) => {
    if (inMachineStep === 0) counts.carsInSession += 1;
    return carsInSessionOf(spans);
  });
  const perFrame = frames.map((frame) => {
    counts = { openSpans: new Map(), carsInSession: 0 };
    step(state, frame);
    return counts;
  });
  vi.restoreAllMocks();
  return { state, perFrame };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('step 2 does each frame span work once (Task PERF, C40)', () => {
  it('a 20-car race runs with every car in the session', () => {
    const { state } = countWork(raceFrames());
    expect(inSession.carsInSessionOf(situationOf(state).byMachine['car-status'])).toEqual(Array.from({ length: CARS }, (_, id) => id));
  });

  it('an unchanged open span is the same object from one frame to the next on a 20-car race', () => {
    const frames = raceFrames();
    const state = initialState(initFor(frames));
    let before = situationOf(state).byMachine;
    const problems = new Set<string>();
    for (const frame of frames) {
      step(state, frame);
      const after = situationOf(state).byMachine;
      for (const m of MACHINES) for (const p of identityProblems(m, before[m.id] ?? [], after[m.id] ?? [])) problems.add(p.replace(/ #\d+ in car \d+/, ' of a car'));
      before = after;
    }
    expect([...problems].sort()).toEqual([]);
  });

  it('each sub-machine builds its open spans at most once per frame', () => {
    const { perFrame } = countWork(raceFrames());
    const most = new Map<MachineId, number>();
    for (const counts of perFrame) for (const [id, n] of counts.openSpans) most.set(id, Math.max(most.get(id) ?? 0, n));
    const over = [...most].filter(([, n]) => n > 1).map(([id, n]) => `${id}: ${n} calls`);
    expect(most.size).toBeGreaterThan(0);
    expect(over).toEqual([]);
  });

  it('the cars in the session are worked out at most once per frame outside the sub-machines', () => {
    const { perFrame } = countWork(raceFrames());
    const most = Math.max(...perFrame.map((counts) => counts.carsInSession));
    const over = perFrame.filter((counts) => counts.carsInSession > 1).length;
    expect(most, `${over} of ${FRAMES} frames call carsInSessionOf more than once`).toBeLessThanOrEqual(1);
  });
});
