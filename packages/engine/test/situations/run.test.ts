// Step 2, the machine (contract C9, C14, C18, C20, C25, C26, C40): `runMachine` runs the sub-machines that apply to the
// weekend phase in their order and appends their closed spans to `spans:<id>`, each with the frame numbers it opened
// and closed on; `situationOf` gives every machine's open spans; `closeSession` closes every open span after the last
// applied frame, so every log is complete; a span's id counts the spans its machine opened before it, also across a
// rewind; a confirmed lap belongs to the spans open at its crossing (`membershipOf`). The registry here is the test
// machines (`test/support/test-machines.ts`) and a race-only one, so these tests hold whatever else is registered;
// their scopes come from their span declarations, added to the domain index (C15).
import { describe, expect, it, vi } from 'vitest';
import { MAX_CARS, type OpenSpan, type SpanDeclaration } from '@pitwall/domain';
import { initialState, membershipOf, SessionRunner, situationAt, type DeepReadonly, type Frame, type StepOutput } from '../../src/index.ts';
import type { Signals } from '../../src/signals/types.ts';
import { clockInput } from '../../src/situations/clock/clock.ts';
import { closeSession, runMachine, situationOf } from '../../src/situations/run.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { initFor, runScenario } from '../support/run.ts';
import { after, drive, runAll, STEP } from '../support/runner.ts';
import type { ProbeDetail } from '../support/test-machines.ts';
import { FRAME_MS } from '../support/transition-table.ts';
import { beats, script } from './script.ts';

vi.mock('../../src/situations/index.generated.ts', async () => {
  const { TEST_MACHINES, raceOnlyMachine } = await import('../support/test-machines.ts');
  return { MACHINES: [...TEST_MACHINES, raceOnlyMachine] };
});
vi.mock('../../../domain/src/situations/index.generated.ts', async (importOriginal) => {
  const { withTestSpans } = await import('../support/test-machines.ts');
  return withTestSpans(await importOriginal<{ SPAN_DECLARATIONS: readonly SpanDeclaration[] }>());
});

const [first] = new ScenarioBuilder({ cars: 2 }).frames(1, () => {}).build() as [Frame];
const fresh = () => initialState(initFor([first]));
type State = ReturnType<typeof fresh>;

/**
 * Step 2 on frame `index` (race-clock time `index * FRAME_MS`, frame number `index + 1`, as step leaves it): the
 * signals as the previous frame left them, without its events, edited by `edit`, as step 1 would leave them.
 */
const machineFrame = (state: State, index: number, edit: (s: Signals) => void = () => {}) => {
  const signals = structuredClone(state.signals);
  signals.events = [];
  edit(signals);
  state.signals = signals;
  state.frameNumber = index + 1;
  const out: StepOutput = { changed: new Set(), corrections: [] };
  runMachine(state, { ...first, frameId: index, sessionTime: index * FRAME_MS }, out);
  return { out };
};

const spanTags = (out: StepOutput): string[] => [...out.changed].filter((tag) => tag.startsWith('spans:')).sort();

/** Frame 0 (number 1): zone 0 yellow, car 1 in the pit lane; frame 1 (number 2): the safety car out, car 1 back on track. */
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
  it('a span records the frame numbers it opened and closed on', () => {
    const state = fresh();
    twoFrames(state);
    machineFrame(state, 2, (s) => {
      s.session.marshalZones = [{ startFraction: 0, flag: 'green' }];
    });
    // opened on frame 1 and closed on frame 2: the span covers frame 1 only; its successor opens on frame 2
    expect(state.log.spans['test-session']).toEqual([
      { machine: 'test-session', id: 0, kind: 'green', start: 0, end: FRAME_MS, confirmed: true, joinedAt: true, detail: undefined, startFrame: 1, endFrame: 2 },
    ]);
    expect(state.log.spans['test-car']).toEqual([
      { machine: 'test-car', id: 0, carId: 1, kind: 'pit', start: 0, end: FRAME_MS, confirmed: true, joinedAt: true, detail: undefined, startFrame: 1, endFrame: 2 },
    ]);
    expect(state.log.spans['test-zone']).toEqual([
      { machine: 'test-zone', id: 0, kind: 'yellow', start: 0, end: 2 * FRAME_MS, confirmed: true, joinedAt: true, detail: { zone: 0 }, startFrame: 1, endFrame: 3 },
    ]);
    expect(situationOf(state).byMachine['test-session']).toEqual([
      { machine: 'test-session', id: 1, kind: 'neutralised', start: FRAME_MS, confirmed: true, detail: undefined, startFrame: 2 },
    ]);
  });
  it('appends the spans a frame closed to spans:<id>', () => {
    const state = fresh();
    twoFrames(state);
    expect(state.log.spans['test-session']?.map((s) => [s.kind, s.id])).toEqual([['green', 0]]);
    expect(state.log.spans['test-car']?.map((s) => [s.carId, s.kind, s.id])).toEqual([[1, 'pit', 0]]);
    expect(state.log.spans['test-zone']).toBeUndefined();
  });
  it('a machine reads the open spans its upstream machine has after this frame, and the clock’s state (clockInput)', () => {
    const state = fresh();
    machineFrame(state, 0);
    machineFrame(state, 1, (s) => {
      s.session.safetyCarStatus = 'sc';
    });
    const detail: ProbeDetail = { at: FRAME_MS, frameId: 1, frameNumber: 2, clock: clockInput(state), upstream: ['neutralised'] };
    expect(situationOf(state).byMachine['test-probe']?.map((s) => s.detail)).toEqual([detail]);
    expect(detail.clock).toEqual({ paused: false, offsetMs: 0 });
  });
  it('a machine reads the clock as step 0 left it on the frame: the offset after a fall, paused while an online pause lasts', () => {
    // online practice: the session time falls from 0.304 s to 0 at frame 20; the game pauses at frame 25
    const frames = script(beats(30, (k) => ({ at: k < 20 ? k * STEP : (k - 20) * STEP, ...(k === 25 && { session: { gamePaused: 1 } }) })), {
      session: { sessionType: 1, networkGame: 1 },
    });
    const runner = new SessionRunner(initFor(frames));
    const seen: Array<ProbeDetail['clock']> = [];
    for (const f of frames) runner.apply(f, (r) => seen.push((situationOf(r.state).byMachine['test-probe']![0]!.detail as ProbeDetail).clock));
    expect([seen[19], seen[20], seen[24], seen[25]]).toEqual([
      { paused: false, offsetMs: 0 },
      { paused: false, offsetMs: 19 * STEP },
      { paused: false, offsetMs: 19 * STEP },
      { paused: true, offsetMs: 19 * STEP },
    ]);
    expect(seen.at(-1)).toEqual(clockInput(runner.state));
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
    expect(situation.byMachine['test-session']).toEqual([{ machine: 'test-session', id: 1, kind: 'neutralised', start: FRAME_MS, confirmed: true, detail: undefined, startFrame: 2 }]);
    expect(situation.byMachine['test-car']?.filter((s) => (s.carId ?? 0) < 2)).toEqual([
      { machine: 'test-car', id: 0, carId: 0, kind: 'track', start: 0, confirmed: true, joinedAt: true, detail: undefined, startFrame: 1 },
      { machine: 'test-car', id: 1, carId: 1, kind: 'track', start: FRAME_MS, confirmed: true, detail: undefined, startFrame: 2 },
    ]);
    expect(situation.byMachine['test-car']?.map((s) => s.carId)).toEqual(Array.from({ length: MAX_CARS }, (_, i) => i));
    expect(situation.byMachine['test-zone']).toEqual([{ machine: 'test-zone', id: 0, kind: 'yellow', start: 0, confirmed: true, joinedAt: true, detail: { zone: 0 }, startFrame: 1 }]);
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
    expect(state.log.spans['test-session']).toEqual([
      { machine: 'test-session', id: 0, kind: 'green', start: 0, end: FRAME_MS, confirmed: true, joinedAt: true, detail: undefined, startFrame: 1, endFrame: 2 },
      { machine: 'test-session', id: 1, kind: 'neutralised', start: FRAME_MS, end: 5_000, confirmed: false, detail: undefined, startFrame: 2, endFrame: 3 },
    ]);
    expect(state.log.spans['test-zone']).toEqual([
      { machine: 'test-zone', id: 0, kind: 'clear', start: 0, end: 5_000, confirmed: true, joinedAt: true, detail: { zone: 0 }, startFrame: 1, endFrame: 3 },
    ]);
    expect(state.log.spans['test-car']).toEqual(open['test-car']!.map((s) => ({ ...s, end: 5_000, endFrame: 3 })));
  });
  it('closeSession closes a span after the last applied frame', () => {
    const state = fresh();
    twoFrames(state);
    machineFrame(state, 2);
    const open = Object.values(situationOf(state).byMachine).flat();
    closeSession(state, 3 * FRAME_MS);
    // the last applied frame is number 3: every span closed by the session's end still covers it
    const key = (s: DeepReadonly<OpenSpan>) => `${s.machine} ${s.carId ?? '-'} #${s.id}`;
    const closed = Object.values(state.log.spans).flat().filter((s) => s.end === 3 * FRAME_MS);
    expect(closed.map(key).sort()).toEqual(open.map(key).sort());
    expect([...new Set(closed.map((s) => s.endFrame))]).toEqual([4]);
    const covering = Object.values(situationAt({ history: { ...state.history, spans: state.log.spans } }, 3)).flat();
    for (const span of closed) expect(covering).toContainEqual(span);
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
      expect(closed, `${span.machine} #${span.id}`).toEqual({ ...span, end, endFrame: runner.state.frameNumber + 1 });
    }
  });
});

describe('membership of superseding facts (C25, C26)', () => {
  it('a confirmed lap belongs to the span open at its crossing', () => {
    // frames 0-2 (numbers 1-3) lap 1, frame 3 (number 4) lap 2 begins: the provisional lap 1, under green; the safety
    // car out from frame 5 (number 6) opens `neutralised`; Session History confirms lap 1 on frame 8 (number 9)
    const history = { carIdx: 0, numLaps: 2, lapHistoryData: [
      { lapTimeInMs: 90_520, sector1TimeMs: 30_000, sector2TimeMs: 31_010, sector3TimeMs: 29_509, lapValidBitFlags: 0b1111 },
      { lapValidBitFlags: 0b1111 }] };
    const b = new ScenarioBuilder({ cars: 1 }).frames(5, (d) => {
      const car = d.lapData.lapData[0]!;
      if (d.index === 1) car.sector1TimeMs = 30_000;
      if (d.index === 2) car.sector2TimeMs = 31_000;
      if (d.index === 3) Object.assign(car, { currentLapNum: 2, lastLapTimeInMs: 90_500, sector1TimeMs: 0, sector2TimeMs: 0 });
    });
    b.session({ safetyCarStatus: 1 }).frames(3, () => {}).frames(1, (d) => { d.add('sessionHistory', history); });
    const { st } = runScenario(b);
    const laps = st.history.laps.filter((l) => l.carId === 0 && l.lapNumber === 1);
    expect(laps.map((l) => [l.status, l.frame])).toEqual([['provisional', 4], ['confirmed', 4]]);
    const source = { history: st.history, situation: situationOf(st) };
    const member = (fact: (typeof laps)[number]) =>
      Object.fromEntries(Object.entries(membershipOf(source, fact)).map(([machine, span]) => [machine, [span.kind, span.id]]));
    expect(member(laps[1]!)).toEqual({ 'test-session': ['green', 0], 'test-probe': ['seen', 3], 'test-car': ['track', 0] });
    expect(member(laps[1]!)).toEqual(member(laps[0]!));
  });
});
