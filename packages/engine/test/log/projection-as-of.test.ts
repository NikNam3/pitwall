// The projection "as of frame N" (SP4.3a plan Task 3, review P1; C25, C26, C28, C29, C30): `projectionAsOf` cuts the
// projection by the frame each entry was appended on (the projection's append frames, `ProjectionState.appendedAt`),
// never by the frame a fact describes, so a confirmed lap appended after N about an earlier frame is absent at N; and it
// gives the situation at N: every span covering N open, a span closed after N among them without its end.
import { describe, expect, it } from 'vitest';
import type { FrameNumber, OpenSpan } from '@pitwall/domain';
import { initialState, projectionAsOf, SessionRunner, situationAt, step, type DeepReadonly, type EngineState, type Frame, type MembershipSource } from '../../src/index.ts';
import type { Projection } from '../../src/log/types.ts';
import { situationOf } from '../../src/situations/run.ts';
import type { Situation } from '../../src/situations/situation.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { gridStart, script } from '../situations/script.ts';
import { initFor } from '../support/run.ts';
import { after, runAll, timeline } from '../support/runner.ts';

/** The projection's fact and span lists, without its append frames: what a reader reads of it. */
const lists = (p: Projection) => {
  const { appendedAt: _appendedAt, ...rest } = p;
  return rest;
};

/** A span as it stood open: without the end and the frame it closed on. */
const opened = (span: DeepReadonly<OpenSpan & { end?: number; endFrame?: FrameNumber }>) => {
  const { end: _end, endFrame: _endFrame, ...rest } = span;
  return rest;
};

/** A stable order of one machine's spans: by car, zone and id. */
const ordered = <S extends { id: number; carId?: number; zone?: number }>(spans: readonly S[]): S[] =>
  [...spans].sort((a, b) => (a.carId ?? -1) - (b.carId ?? -1) || (a.zone ?? -1) - (b.zone ?? -1) || a.id - b.id);

/** Per machine, its spans as they stood open, in a stable order. */
const byMachineOpened = (byMachine: Readonly<Record<string, readonly DeepReadonly<OpenSpan & { endFrame?: FrameNumber }>[]>>) =>
  Object.fromEntries(Object.entries(byMachine).map(([machine, spans]) => [machine, ordered(spans.map(opened))]));

/** What a running session's projection is read through (C20, C26): its projection and its open spans. */
const sourceOf = (st: DeepReadonly<EngineState>): MembershipSource => ({ history: st.history, situation: situationOf(st as EngineState) });

/** Each frame through `step`, with a copy of the projection and the situation after it, by the frame's number. */
const stepped = (frames: Frame[]) => {
  const st = initialState(initFor(frames));
  const after = new Map<FrameNumber, { history: Projection; situation: Situation }>();
  const numbers: FrameNumber[] = [];
  for (const frame of frames) {
    step(st, frame);
    numbers.push(st.frameNumber);
    after.set(st.frameNumber, structuredClone({ history: st.history, situation: situationOf(st) }));
  }
  return { st, after, numbers };
};

const car = (d: FrameDraft, i: number) => d.lapData.lapData[i]!;

/**
 * Two cars: car 0 completes lap 1 on frame index 3 (its provisional lap describes that frame), car 1 on index 6, and
 * Session History confirms car 0's lap on index 8 (the confirmed record describes the provisional's crossing, C25, C26).
 */
const confirmedLater = () =>
  new ScenarioBuilder({ cars: 2 })
    .frames(9, (d) => {
      if (d.index === 1) car(d, 0).sector1TimeMs = 30_000;
      if (d.index === 2) car(d, 0).sector2TimeMs = 31_000;
      if (d.index === 3) Object.assign(car(d, 0), { currentLapNum: 2, lastLapTimeInMs: 90_500, sector1TimeMs: 0, sector2TimeMs: 0 });
      if (d.index === 6) Object.assign(car(d, 1), { currentLapNum: 2, lastLapTimeInMs: 91_000 });
      if (d.index === 8)
        d.add('sessionHistory', {
          carIdx: 0,
          numLaps: 2,
          lapHistoryData: [{ lapTimeInMs: 90_520, sector1TimeMs: 30_000, sector2TimeMs: 31_010, sector3TimeMs: 29_510, lapValidBitFlags: 0b1111 }, { lapValidBitFlags: 0b1111 }],
        });
    })
    .build();

describe('projectionAsOf: the cut by append frame (P1)', () => {
  it('projectionAsOf keeps exactly the entries appended on frames up to N', () => {
    const { st, after, numbers } = stepped(confirmedLater());
    const laps = st.history.laps;
    const provisional = laps.find((l) => l.carId === 0 && l.status === 'provisional')!;
    const confirmed = laps.find((l) => l.carId === 0 && l.status === 'confirmed')!;
    const rival = laps.find((l) => l.carId === 1)!;
    // the frame each was appended on: the frame of the step whose projection first holds it
    const appendedOn = (lap: unknown) => numbers.find((n) => after.get(n)!.history.laps.some((l) => JSON.stringify(l) === JSON.stringify(lap)))!;
    const C = appendedOn(confirmed);
    const N = C - 3;
    // the scenario as the plan's row names it: confirmed at N+3 about frame N−2, the rival's lap completed at N+1
    expect(confirmed.frame).toBe(N - 2);
    expect(provisional.frame).toBe(N - 2);
    expect(appendedOn(rival)).toBe(N + 1);

    const source = sourceOf(st);
    const atN = projectionAsOf(source, N).history;
    expect(atN.laps).toEqual([provisional]);
    expect(projectionAsOf(source, N + 1).history.laps).toEqual([provisional, rival]);
    expect(projectionAsOf(source, N + 2).history.laps).toEqual([provisional, rival]);
    expect(projectionAsOf(source, N + 3).history.laps).toEqual([provisional, rival, confirmed]);

    // at every frame, every list is the projection as it stood after that frame
    for (const n of numbers) expect(lists(projectionAsOf(source, n).history), `frame ${n}`).toEqual(lists(after.get(n)!.history));
  });

  it('projectionAsOf: a span closed after N is open at N in the situation, one closed at or before N stays closed', () => {
    const { st, after, numbers } = stepped(script(gridStart(30)));
    const source = sourceOf(st);
    const phases = st.history.spans['session-phase-race'] ?? [];
    // the grid and the start lights close before the end; pick N inside a span that closed later
    const later = phases.find((s) => s.endFrame - s.startFrame > 2)!;
    expect(later).toBeDefined();
    const N = later.startFrame + 1;
    const cut = projectionAsOf(source, N);

    // the span closed after N: open in the situation, without its end; not in the cut's closed spans
    expect(cut.situation.byMachine['session-phase-race']).toContainEqual(opened(later));
    expect(cut.history.spans['session-phase-race'] ?? []).not.toContainEqual(later);
    // a span closed at or before N: closed, in the cut's history, not open
    for (const closed of phases.filter((s) => s.endFrame <= N)) {
      expect(cut.history.spans['session-phase-race']).toContainEqual(closed);
      expect(cut.situation.byMachine['session-phase-race'] ?? []).not.toContainEqual(opened(closed));
    }
    // the situation at N is every span covering N, as membership finds it (C26), each as it stood open
    // (the cut's situation keeps every machine of the run's, also those with no open span; membership lists only machines
    // with a span covering N: an empty list and a missing machine say the same)
    const covering = (byMachine: Parameters<typeof byMachineOpened>[0]) =>
      Object.fromEntries(Object.entries(byMachineOpened(byMachine)).filter(([, spans]) => spans.length > 0));
    expect(covering(cut.situation.byMachine)).toEqual(covering(situationAt(source, N)));
    // the cut's situation holds the spans the run had open after N, by identity, and its weekend phase
    const identity = (byMachine: Situation['byMachine']) =>
      Object.fromEntries(Object.entries(byMachine).map(([m, spans]) => [m, ordered(spans).map((s) => [s.id, s.carId, s.zone, s.kind, s.startFrame])]));
    for (const n of numbers) {
      const at = projectionAsOf(source, n).situation;
      expect(identity(at.byMachine), `frame ${n}`).toEqual(identity(after.get(n)!.situation.byMachine));
      expect(at.weekendPhase).toEqual(after.get(n)!.situation.weekendPhase);
    }
  });

  it('projectionAsOf at the current frame equals the projection', () => {
    for (const frames of [confirmedLater(), script(gridStart(30))]) {
      const { st } = stepped(frames);
      const source = sourceOf(st);
      const cut = projectionAsOf(source, st.frameNumber);
      expect(cut.history).toEqual(st.history);
      expect(byMachineOpened(cut.situation.byMachine)).toEqual(byMachineOpened(source.situation!.byMachine));
      expect(cut.situation.weekendPhase).toEqual(source.situation!.weekendPhase);
    }
  });

  it('projectionAsOf never shows a hidden fact', () => {
    // a lap crossed in the formation lap (C29): the log keeps it, the projection and every cut of it skip it
    const formation = new ScenarioBuilder({ cars: 1, stepMs: 1000 })
      .frames(1, () => {})
      .session({ safetyCarStatus: 3 })
      .frames(1, () => {})
      .frames(2, (d) => Object.assign(car(d, 0), { currentLapNum: 2, lastLapTimeInMs: 90_000 }))
      .build();
    const { st, numbers } = stepped(formation);
    // the formation lap's record is in the log and hidden: the projection skips it
    expect(st.log.laps).toHaveLength(1);
    expect(st.history.laps).toEqual([]);
    for (const n of numbers) expect(projectionAsOf(sourceOf(st), n).history.laps, `frame ${n}`).toEqual([]);

    // a flashback's voided entries (C27): the original's laps begin at 100 and 250; the game goes back to frame 200 and
    // the fork's lap 3 begins at 330, so the lap completed at 250 never happened
    const original = timeline(300, [100, 250]);
    const fork = timeline(400, [100, 330]);
    const runner = new SessionRunner(initFor(original));
    runAll(runner, original);
    const undoneNumber = runner.state.frameNumber;
    runAll(runner, after(fork, 201, 300));
    expect(runner.state.log.voids).toHaveLength(1);
    const source = sourceOf(runner.state);
    const shownLaps = runner.state.history.laps;
    const voided = runner.state.log.laps.filter((l) => !shownLaps.some((v) => JSON.stringify(v) === JSON.stringify(l)));
    expect(voided.length).toBeGreaterThan(0);
    // before the target, between it and the flashback point (where the voided lap was appended), past it, and now
    for (const n of [150, 199, 201, 250, 251, 299, undoneNumber, 330, 331, runner.state.frameNumber]) {
      const cut = projectionAsOf(source, n).history;
      for (const v of voided) expect(cut.laps, `frame ${n}`).not.toContainEqual(v);
      for (const l of cut.laps) expect(shownLaps, `frame ${n}`).toContainEqual(l);
    }
    expect(projectionAsOf(source, runner.state.frameNumber).history.laps).toEqual(shownLaps);
  });

  it('append frames survive a rewind and a structured clone', () => {
    // original: frames 0..299, laps begin at 100 and 250; the game goes back to frame 200, the fork's lap 3 begins at 330
    const original = timeline(300, [100, 250]);
    const fork = timeline(400, [100, 330]);
    const rewound = new SessionRunner(initFor(original));
    runAll(rewound, original);
    // the fork's frame ids fall back below the last one: the game went back (the frameId backup, C27)
    runAll(rewound, after(fork, 201, 300));
    expect(rewound.state.log.voids).toHaveLength(1);
    const reference = new SessionRunner(initFor(fork));
    runAll(reference, fork);
    expect(rewound.state.frameNumber).toBe(reference.state.frameNumber);

    const a = sourceOf(rewound.state);
    const b = sourceOf(reference.state);
    const cloned: MembershipSource = structuredClone({ history: rewound.state.history, situation: situationOf(rewound.state) });
    // the cut after the rewind equals a run without the undone frames: before the target, between it and the
    // flashback point, and after it
    for (const n of [50, 150, 199, 201, 250, 299, 330, rewound.state.frameNumber]) {
      const expected = projectionAsOf(b, n);
      expect(lists(projectionAsOf(a, n).history), `frame ${n}`).toEqual(lists(expected.history));
      expect(byMachineOpened(projectionAsOf(a, n).situation.byMachine), `frame ${n}`).toEqual(byMachineOpened(expected.situation.byMachine));
      // a structured clone of the projection (a job's input) carries its append frames: it cuts the same
      expect(projectionAsOf(cloned, n), `clone, frame ${n}`).toEqual(projectionAsOf(a, n));
    }
    // the append frames themselves are a run's without the undone frames (C33)
    expect(rewound.state.history.appendedAt).toEqual(reference.state.history.appendedAt);
  });
});
