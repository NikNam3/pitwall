// Step 2, the machine (contract C9, C14, C18, C20, C26, C40): `runMachine` runs the sub-machines that apply to the
// weekend phase in their order, appends their closed spans to `spans:<id>` and returns the frame's stamps;
// `situationOf` gives every machine's open spans; `closeSession` closes every open span, so every log is complete; a
// span's id counts the spans its machine opened before it, also across a rewind. The registry here is the test
// machines (`test/support/test-machines.ts`) and a race-only one, so these tests hold whatever else is registered.
import { describe, expect, it, vi } from 'vitest';
import { MAX_CARS, type OpenSpan, type Span } from '@pitwall/domain';
import { initialState, SessionRunner, type DeepReadonly, type Frame, type StepOutput } from '../../src/index.ts';
import type { Signals } from '../../src/signals/types.ts';
import { closeSession, runMachine, situationOf } from '../../src/situations/run.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { initFor } from '../support/run.ts';
import { after, drive, runAll, STEP } from '../support/runner.ts';
import type { ProbeDetail } from '../support/test-machines.ts';
import { FRAME_MS } from '../support/transition-table.ts';

vi.mock('../../src/situations/index.generated.ts', async () => {
  const { TEST_MACHINES, raceOnlyMachine } = await import('../support/test-machines.ts');
  return { MACHINES: [...TEST_MACHINES, raceOnlyMachine] };
});

const [first] = new ScenarioBuilder({ cars: 2 }).frames(1, () => {}).build() as [Frame];
const fresh = () => initialState(initFor([first]));
type State = ReturnType<typeof fresh>;

/**
 * Step 2 on frame `index` (race-clock time `index * FRAME_MS`): the signals as the previous frame left them, without
 * its events, edited by `edit`, as step 1 would leave them.
 */
const machineFrame = (state: State, index: number, edit: (s: Signals) => void = () => {}) => {
  const signals = structuredClone(state.signals);
  signals.events = [];
  edit(signals);
  state.signals = signals;
  const out: StepOutput = { changed: new Set(), corrections: [] };
  const stamps = runMachine(state, { ...first, frameId: index, sessionTime: index * FRAME_MS }, out);
  return { stamps, out };
};

const withoutStamp = ({ in: _in, ...span }: DeepReadonly<Span>) => span;
const spanTags = (out: StepOutput): string[] => [...out.changed].filter((tag) => tag.startsWith('spans:')).sort();

/** Frame 0: zone 0 yellow, car 1 in the pit lane; frame 1: the safety car out, car 1 back on track. */
const twoFrames = (state: State) => {
  const zero = machineFrame(state, 0, (s) => {
    s.session.marshalZones = [{ startFraction: 0, flag: 'yellow' }];
    s.cars[1]!.pitStatus = 'pitting';
  });
  const one = machineFrame(state, 1, (s) => {
    s.session.safetyCarStatus = 'sc';
    s.cars[1]!.pitStatus = 'none';
  });
  return { zero, one };
};

describe('runMachine', () => {
  it("the frame's stamps hold the session-scoped spans and each car's own spans; zone spans are never stamped", () => {
    const { one } = twoFrames(fresh());
    expect(one.stamps.session).toEqual({ 'test-session': 1, 'test-probe': 1 });
    expect(one.stamps.cars[0]).toEqual({ 'test-car': 0 });
    expect(one.stamps.cars[1]).toEqual({ 'test-car': 1 });
    expect(one.stamps.cars.map((stamp) => Object.keys(stamp))).toEqual(Array.from({ length: MAX_CARS }, () => ['test-car']));
  });
  it('appends the spans a frame closed to spans:<id>', () => {
    const state = fresh();
    twoFrames(state);
    expect(state.log.spans['test-session']?.map(withoutStamp)).toEqual([
      { machine: 'test-session', id: 0, kind: 'green', start: 0, end: FRAME_MS, confirmed: true, joinedAt: true, detail: undefined },
    ]);
    expect(state.log.spans['test-car']?.map(withoutStamp)).toEqual([
      { machine: 'test-car', id: 0, carId: 1, kind: 'pit', start: 0, end: FRAME_MS, confirmed: true, joinedAt: true, detail: undefined },
    ]);
    expect(state.log.spans['test-zone']).toBeUndefined();
  });
  it('a machine reads the open spans its upstream machine has after this frame, and the clock’s state', () => {
    const state = fresh();
    machineFrame(state, 0);
    state.open.phaseBook.clockOffsetMs = 250;
    machineFrame(state, 1, (s) => {
      s.session.safetyCarStatus = 'sc';
    });
    const detail: ProbeDetail = { at: FRAME_MS, frameId: 1, clock: { paused: false, offsetMs: 250 }, upstream: ['neutralised'] };
    expect(situationOf(state).byMachine['test-probe']?.map((s) => s.detail)).toEqual([detail]);
  });
  it('while the weekend phase is pending, a machine of one weekend phase does not run (C14)', () => {
    const state = fresh();
    twoFrames(state);
    expect(situationOf(state).weekendPhase).toEqual({ kind: 'pending' });
    expect(situationOf(state).byMachine['test-race-only'] ?? []).toEqual([]);
    expect(state.log.spans['test-race-only']).toBeUndefined();
  });
  it('tags spans:<id> on a frame that changes the machine’s spans, and only then (C40)', () => {
    const state = fresh();
    const { one } = twoFrames(state);
    expect(spanTags(one.out)).toEqual(['spans:test-car', 'spans:test-probe', 'spans:test-session']);
    expect(spanTags(machineFrame(state, 2).out)).toEqual(['spans:test-probe']);
  });
});

describe('situationOf', () => {
  it('holds every machine’s open spans and the weekend phase (C20)', () => {
    const state = fresh();
    twoFrames(state);
    const situation = situationOf(state);
    expect(situation.byMachine['test-session']).toEqual([{ machine: 'test-session', id: 1, kind: 'neutralised', start: FRAME_MS, confirmed: true, detail: undefined }]);
    expect(situation.byMachine['test-car']?.filter((s) => (s.carId ?? 0) < 2)).toEqual([
      { machine: 'test-car', id: 0, carId: 0, kind: 'track', start: 0, confirmed: true, joinedAt: true, detail: undefined },
      { machine: 'test-car', id: 1, carId: 1, kind: 'track', start: FRAME_MS, confirmed: true, detail: undefined },
    ]);
    expect(situation.byMachine['test-car']?.map((s) => s.carId)).toEqual(Array.from({ length: MAX_CARS }, (_, i) => i));
    expect(situation.byMachine['test-zone']).toEqual([{ machine: 'test-zone', id: 0, kind: 'yellow', start: 0, confirmed: true, joinedAt: true, detail: { zone: 0 } }]);
  });
});

describe('closeSession', () => {
  it('closes every open span as a fact at its time; a pending confirmation closes unconfirmed (C18)', () => {
    const state = fresh();
    machineFrame(state, 0, (s) => {
      s.session.marshalZones = [{ startFraction: 0, flag: 'green' }];
    });
    machineFrame(state, 1, (s) => {
      s.events.push({ code: 'SCAR', car: 'SC', stage: 'deployed' });
    });
    const open = situationOf(state).byMachine;
    closeSession(state, 5_000);
    expect(state.log.spans['test-session']?.map(withoutStamp)).toEqual([
      { machine: 'test-session', id: 0, kind: 'green', start: 0, end: FRAME_MS, confirmed: true, joinedAt: true, detail: undefined },
      { machine: 'test-session', id: 1, kind: 'neutralised', start: FRAME_MS, end: 5_000, confirmed: false, detail: undefined },
    ]);
    expect(state.log.spans['test-zone']?.map(withoutStamp)).toEqual([
      { machine: 'test-zone', id: 0, kind: 'clear', start: 0, end: 5_000, confirmed: true, joinedAt: true, detail: { zone: 0 } },
    ]);
    expect(state.log.spans['test-car']?.map(withoutStamp)).toEqual(open['test-car']!.map((s) => ({ ...s, end: 5_000 })));
  });
});

/** Car 0 drives, in the pit lane on the frames of `pits` (`[from, to)` each). */
const pitTimeline = (frames: number, pits: ReadonlyArray<readonly [number, number]>): Frame[] => {
  const b = new ScenarioBuilder({ cars: 2, stepMs: STEP }).session({ trackLength: 4000 });
  for (let i = 0; i < frames; i++) {
    b.frame((d) => {
      drive([])(d);
      d.lapData.lapData[0]!.pitStatus = pits.some(([from, to]) => i >= from && i < to) ? 1 : 0;
    });
  }
  return b.build();
};

/** Car 0's spans of `test-car`, as kind and id. */
const carZero = (spans: ReadonlyArray<DeepReadonly<OpenSpan>> | undefined) => (spans ?? []).filter((s) => s.carId === 0).map((s) => [s.kind, s.id]);

describe('span ids (C26)', () => {
  // the game goes back from frame 25 to frame 15, inside car 0's first pit stop; this time the car leaves at 18, not 20
  const original = () => pitTimeline(26, [[10, 20]]);
  const fork = () => pitTimeline(60, [[10, 18], [30, 40]]);

  it('count the spans opened before them; after a rewind the re-opened spans get the ids a run without the undone frames gives', () => {
    const straight = new SessionRunner(initFor(fork()));
    runAll(straight, fork());
    const rewound = new SessionRunner(initFor(original()));
    runAll(rewound, [...original(), ...after(fork(), 16, 26)]);

    expect(carZero(straight.state.history.spans['test-car'])).toEqual([['track', 0], ['pit', 1], ['track', 2], ['pit', 3]]);
    expect(carZero(situationOf(straight.state).byMachine['test-car'])).toEqual([['track', 4]]);
    expect(rewound.state.history.spans).toEqual(straight.state.history.spans);
    expect(situationOf(rewound.state)).toEqual(situationOf(straight.state));
  });
});

describe('SessionRunner.finish', () => {
  it('closes every open span of every machine at the last frame’s time, so the log is complete', () => {
    const frames = pitTimeline(30, [[10, 20]]);
    const runner = new SessionRunner(initFor(frames));
    runAll(runner, frames);
    const end = runner.state.sessionTime;
    const open = Object.values(situationOf(runner.state).byMachine).flat();
    expect(open.length).toBeGreaterThan(0);
    runner.finish();
    const logged = Object.values(runner.state.log.spans).flat();
    for (const span of open) {
      const closed = logged.find((s) => s.machine === span.machine && s.id === span.id && s.carId === span.carId);
      expect(closed && withoutStamp(closed), `${span.machine} #${span.id}`).toEqual({ ...span, end });
    }
  });
});
