// SessionRunner: how a flashback is recognised and reported once, the void fact it appends (C27), the attached
// bookkeeping it restores, and what a rewind keeps. Every frame of the scenarios here carries a race event, so a frame
// replayed twice or lost in a replay shows in the history.
import { describe, expect, it } from 'vitest';
import { currentLaps, feedId, toSessionTime, type Insight, type LapRecord } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import {
  CalculatorRegistry,
  Scheduler,
  SessionRunner,
  situationOf,
  type DeepReadonly,
  type Frame,
  type InsightChange,
  type QuickCalculator,
  type Snapshotable,
  type StepResult,
} from '../../src/index.ts';
import { buildPacket, ScenarioBuilder } from '../builders/index.ts';
import { IDLE_FEED } from '../helpers/incremental.ts';
import { initFor } from '../support/run.ts';
import { inputOf } from '../support/scheduler.ts';
import { after, applyOne, drive, factLengths, factLists, flashbacks, flbk, runAll, shown, STEP, timeline as plainTimeline, undoneTick } from '../support/runner.ts';
import { gridStart, LIGHTS_OUT, ovtk, scar, script } from '../situations/script.ts';

const overtake: EventDetails = { code: 'OVTK', overtakingVehicleIdx: 0, beingOvertakenVehicleIdx: 1 };
/** The shared timeline with an overtake in every frame, before the events `extra` names for its index. */
const timeline = (frames: number, lapStarts: number[], extra: (index: number) => EventDetails[] = () => []) =>
  plainTimeline(frames, lapStarts, (i) => [overtake, ...extra(i)]);
/** A frame assembled with the event: its events and, for an FLBK, the flashback report frame assembly puts on it. */
const carrierOf = (details: EventDetails): Frame =>
  new ScenarioBuilder({ cars: 2, stepMs: STEP }).session({ trackLength: 4000 }).frames(1, () => {}).event(details).frames(1, () => {}).build()[1]!;
/** `frame` with the event added as frame assembly adds it: the frame keeps its first FLBK's report. */
const withEvents = (frame: Frame, details: EventDetails): Frame => {
  const carrier = carrierOf(details);
  const flashback = frame.flashback ?? carrier.flashback;
  return { ...frame, events: [...frame.events, ...carrier.events], ...(flashback && { flashback }) };
};
/** What a run that only ever had `frames` shows (see `shown`). */
const sameAs = (frames: Frame[]) => {
  const reference = new SessionRunner(initFor(frames));
  runAll(reference, frames);
  return shown(reference.state);
};

describe('SessionRunner: recognising a flashback', () => {
  // original: frames 0..299, laps begin at 100 and 250; the game goes back to frame 200 where lap 3 begins at 330
  const original = () => timeline(300, [100, 250]);
  const fork = () => timeline(400, [100, 330]);

  it('an FLBK event rewinds although the frame ids keep rising', () => {
    const frames = original();
    const a = new SessionRunner(initFor(frames));
    runAll(a, frames);
    const rewinding = withEvents({ ...frames[299]!, frameId: 300, overallFrameId: 300 }, flbk(200));
    const result = applyOne(a, rewinding);
    expect([result.delta.rewound, result.flashback]).toEqual([{ frameId: 200, at: 3_200 }, { targetFrameId: 200, targetSessionTime: 3_200, rewoundMs: 299 * STEP - 3_200, targetLap: 2 }]);
  });
  it('an event that is no flashback does not rewind', () => {
    const frames = original();
    const a = new SessionRunner(initFor(frames));
    runAll(a, frames);
    const quiet = withEvents({ ...frames[299]!, frameId: 300, overallFrameId: 300 }, { code: 'FTLP', vehicleIdx: 0, lapTime: 80 });
    expect(flashbacks([applyOne(a, quiet)])).toBe(0);
  });
  it('the frameId backup still finds a flashback in a frame that carries another event', () => {
    const frames = original();
    const continuation = after(timeline(400, [100, 330], (i) => (i === 201 ? [{ code: 'FTLP', vehicleIdx: 0, lapTime: 80 }] : [])), 201, 300);
    const a = new SessionRunner(initFor(frames));
    runAll(a, frames);
    const [first] = runAll(a, continuation);
    expect([first!.delta.rewound !== undefined, first!.flashback?.targetFrameId]).toEqual([true, 200]);
  });
  it.each([
    ['the frame just applied', 299],
    ['a frame that has not happened', 350],
  ])('an FLBK to %s is no rewind', (_, target) => {
    const frames = timeline(302, [100, 250], (i) => (i === 300 ? [flbk(target)] : []));
    const a = new SessionRunner(initFor(frames));
    expect(flashbacks(runAll(a, frames))).toBe(0);
  });
  it('a frame with the same id as the last one is no flashback', () => {
    const frames = original();
    const a = new SessionRunner(initFor(frames));
    runAll(a, frames);
    expect(flashbacks([applyOne(a, { ...frames[299]!, overallFrameId: 300 })])).toBe(0);
  });
  it('a late frame with a lower id and an overallFrameId that did not rise is no flashback', () => {
    const frames = original();
    const a = new SessionRunner(initFor(frames));
    runAll(a, frames);
    const results = [applyOne(a, { ...frames[250]!, overallFrameId: 299 }), applyOne(a, { ...frames[251]!, overallFrameId: 200 })];
    expect(flashbacks(results)).toBe(0);
  });

  it('with an event in every frame, the rewind and the continuation equal a run that never saw the discarded frames', () => {
    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    runAll(a, after(fork(), 201, 300));
    expect(shown(a.state)).toEqual(sameAs(fork()));
    expect(a.state.history.events).toHaveLength(400);
  });
  it('a target before the first snapshot replays from the first frame', () => {
    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    expect(applyOne(a, after(fork(), 6, 300)[0]!).flashback?.targetFrameId).toBe(5);
    runAll(a, after(fork(), 7, 301));
    expect(shown(a.state)).toEqual(sameAs(fork()));
  });
});

describe('SessionRunner: a flashback appends a void fact (C27)', () => {
  // original: frames 0..299, laps begin at 100 and 250; the game goes back to frame 200 (an FLBK in the fork's frame 201)
  const original = () => timeline(300, [100, 250]);
  const continuation = () => after(timeline(400, [100, 330], (i) => (i === 201 ? [flbk(200)] : [])), 201, 300);
  /** The runner snapshots once per 1000 ms of session time (16 ms a frame): after frames 63, 126 and 189, the newest at or before the target. */
  const SNAPSHOT = 189;
  const TARGET = { frameId: 200, at: 200 * STEP };

  it('a flashback appends one void fact and removes nothing', () => {
    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    const before = structuredClone(factLists(a.state.log));
    const voids = a.state.log.voids.length;
    const r = applyOne(a, continuation()[0]!);
    expect(r.delta.rewound).toEqual(TARGET);
    expect(a.state.log.voids.length).toBe(voids + 1);
    expect(a.state.log.voids.at(-1)!.target).toEqual(TARGET);
    // every fact list keeps what it held, in place: the log's lengths only grow
    const kept = (lists: Record<string, readonly unknown[]>) => Object.fromEntries(Object.entries(before).map(([list, facts]) => [list, lists[list]!.slice(0, facts.length)]));
    expect(kept(factLists(a.state.log))).toEqual(before);
    runAll(a, continuation().slice(1));
    expect(kept(factLists(a.state.log))).toEqual(before);
    expect(a.state.log.voids.length).toBe(voids + 1);
  });

  it('the void starts at the snapshot’s lengths, and the replayed frames re-append the facts between the snapshot and the target', () => {
    // a run of the original alone: its log's lengths after each frame, and its facts
    const control = new SessionRunner(initFor(original()));
    const lengthsAfter = original().map((f) => {
      applyOne(control, f);
      return factLengths(control.state.log);
    });
    const originalFacts = factLists(control.state.log);
    const atSnapshot = lengthsAfter[SNAPSHOT]!;
    const atTarget = lengthsAfter[TARGET.frameId]!;

    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    const atFlashback = factLengths(a.state.log);
    applyOne(a, continuation()[0]!);
    const voided = a.state.log.voids.at(-1)!;

    // per fact list that grew since the snapshot: [length at the snapshot, length at the flashback)
    const grown = Object.entries(atFlashback).filter(([list, n]) => n > (atSnapshot[list] ?? 0));
    expect(grown.map(([list]) => list)).toEqual(expect.arrayContaining(['events', 'crossings']));
    const ranges = Object.entries(voided.ranges).filter(([, range]) => range !== undefined && range[1] > range[0]);
    expect(Object.fromEntries(ranges)).toEqual(Object.fromEntries(grown.map(([list, n]) => [list, [atSnapshot[list] ?? 0, n]])));
    // after the void the replayed frames (190..200) append what they appended the first time, in order
    const now = factLists(a.state.log);
    const replayed = Object.fromEntries(Object.keys(atFlashback).map((list) => [list, originalFacts[list]!.slice(atSnapshot[list] ?? 0, atTarget[list] ?? 0)]));
    const afterVoid = Object.fromEntries(Object.entries(atFlashback).map(([list, n]) => [list, now[list]!.slice(n, n + replayed[list]!.length)]));
    expect(afterVoid).toEqual(replayed);
    expect(replayed['events']).toHaveLength(TARGET.frameId - SNAPSHOT);
  });
});

describe('SessionRunner: the attached bookkeeping rewinds with the state (C27, C30)', () => {
  // original: frames 0..299, laps begin at 100 and 250; the game goes back to frame 200 (lap 2), the fork's lap 3 begins at 330
  const original = () => timeline(300, [100, 250]);
  const continuation = () => after(timeline(400, [100, 330]), 201, 300);

  it('the attached bookkeeping is restored as it stood once the target frame’s result was handed out', () => {
    // counts the results handed out, as a scheduler's bookkeeping counts the frames it ran on
    const counter = { results: 0 };
    const attach: Snapshotable<number> = { snapshot: () => counter.results, restore: (n) => { counter.results = n; } };
    const a = new SessionRunner(initFor(original()), { attach });
    const seen: number[] = [];
    const count = () => {
      seen.push(counter.results);
      counter.results++;
    };
    for (const f of original()) a.apply(f, count);
    seen.length = 0;
    a.apply(continuation()[0]!, count);
    expect(seen).toEqual([201]);                                                       // frames 0..200 handed out
  });

  const insight = (key: string): Insight => ({ key, severity: 'info', category: 'race', feedId: feedId('test'), kind: key, params: {}, raisedAt: toSessionTime(0) });
  // car 0's lap; an insight per lap from lap 2 on: `lap2` raised at frame 100, before the target, `lap3` at frame 250, after it
  const lapProbe: QuickCalculator<number> = {
    kind: 'quick', id: 'probe.lap', reads: ['timing'], cadence: 'frame',
    compute: (v) => v.live.cars[0]!.timing.lap,
    insights: (lap) => [...(lap >= 2 ? [insight('lap2')] : []), ...(lap >= 3 ? [insight('lap3')] : [])],
  };

  it('after a flashback the scheduler’s bookkeeping is the snapshot’s: an insight raised after the target is gone, one raised before it stays', () => {
    const scheduler = new Scheduler(CalculatorRegistry.build([lapProbe]), { freezeOutputs: true });
    scheduler.setNeeded([lapProbe.id]);
    const runner = new SessionRunner(initFor(original()), { attach: scheduler });
    const changes: InsightChange[] = [];
    let atRewind: Insight[] | undefined;
    const schedule = (r: StepResult) => {
      if (r.delta.rewound !== undefined) atRewind = scheduler.activeInsights;
      const input = inputOf(r, { feed: IDLE_FEED });
      changes.push(...scheduler.run(input).insights);
    };
    for (const f of original()) runner.apply(f, schedule);
    expect(scheduler.activeInsights.map((i) => [i.key, i.raisedAt])).toEqual([['lap2', 100 * STEP], ['lap3', 250 * STEP]]);
    const before = changes.length;
    for (const f of continuation()) runner.apply(f, schedule);
    expect(atRewind?.map((i) => [i.key, i.raisedAt])).toEqual([['lap2', 100 * STEP]]);
    // nothing of the undone timeline is taken back (`lap3` never happened); the fork's lap 3 raises it anew at frame 330
    expect(changes.slice(before)).toEqual([{ type: 'raised', insight: { ...insight('lap3'), raisedAt: 330 * STEP } }]);
  });
});

// Review F3 of Task 3: a target older than the replay window has no kept frames after its snapshot, so the state and the
// bookkeeping are the snapshot's; the rewind targets that snapshot, and the insight changes a publisher keeps up to the
// target (C30) are then what the scheduler holds.
describe('SessionRunner: a rewind deeper than the replay window', () => {
  const laps = Array.from({ length: 24 }, (_, k) => 100 * (k + 1));
  // 2500 frames (40 s) run the 30 s window past frame 90; the game goes back to it (frame id drop, no FLBK)
  const original = () => timeline(2500, laps);
  const continuation = () => after(timeline(201, laps), 91, 2500);
  const insight = (key: string): Insight => ({ key, severity: 'info', category: 'race', feedId: feedId('test'), kind: key, params: {}, raisedAt: toSessionTime(0) });
  /** `a` holds from 1100 ms on (raised at frame 69: after the snapshot of frame 63, before the target 90), `b` from 5000 ms. */
  const clockProbe: QuickCalculator<number> = {
    kind: 'quick', id: 'probe.clock', reads: ['feed'], cadence: 'frame',
    compute: (v) => v.live.sessionTime,
    insights: (t) => [...(t >= 1100 ? [insight('a')] : []), ...(t >= 5000 ? [insight('b')] : [])],
  };

  it('targets the snapshot’s frame and time, and the insight changes kept up to the target are the scheduler’s active insights', () => {
    const scheduler = new Scheduler(CalculatorRegistry.build([clockProbe]), { freezeOutputs: true });
    scheduler.setNeeded([clockProbe.id]);
    const runner = new SessionRunner(initFor(original()), { attach: scheduler });
    let kept: Array<{ frameId: number; change: InsightChange }> = [];
    const rewinds: unknown[] = [];
    const schedule = (r: StepResult, applied: Frame) => {
      const target = r.delta.rewound;
      if (target !== undefined) {
        rewinds.push(target);
        kept = kept.filter((k) => k.frameId <= target.frameId);
      }
      const input = inputOf(r, { feed: IDLE_FEED });
      kept.push(...scheduler.run(input).insights.map((change) => ({ frameId: applied.frameId, change })));
    };
    for (const f of [...original(), ...continuation()]) runner.apply(f, schedule);
    expect(rewinds).toEqual([{ frameId: 63, at: 63 * STEP }]);
    // the kept changes as a client folds them: a raise adds, a resolve removes
    const held = kept.reduce<Insight[]>((active, { change }) =>
      (change.type === 'raised' ? [...active, change.insight] : active.filter((i) => i.key !== change.key)), []);
    expect(held).toEqual(scheduler.activeInsights);
    expect(held.map((i) => [i.key, i.raisedAt])).toEqual([['a', 91 * STEP]]);                // raised anew on the rewinding frame
  });
});

describe('SessionRunner: a flashback restores updatedAt with the snapshot', () => {
  // the original timeline receives a setup in every frame from 250 on; the fork never does
  const original = () => timeline(300, [100, 250]).map((f, i) => (i >= 250 ? { ...f, setups: buildPacket('carSetups') } : f));
  const fork = () => timeline(400, [100, 330]);

  it('a source that only the discarded frames updated is not updated again', () => {
    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    expect(a.state.cars[0]!.updatedAt.setups).toBe(299 * STEP);
    runAll(a, after(fork(), 201, 300));
    expect(a.state.cars[0]!.updatedAt).not.toHaveProperty('setups');
    expect(a.state.cars[0]!.updatedAt.lapData).toBe(399 * STEP);
  });
  it('updatedAt equals that of a run that never saw the discarded frames', () => {
    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    runAll(a, after(fork(), 201, 300));
    const reference = sameAs(fork());
    expect(a.state.cars.map((c) => c.updatedAt)).toEqual(reference.cars.map((c) => c.updatedAt));
  });
});

describe('SessionRunner: a flashback is reported once', () => {
  const original = () => timeline(300, [100, 250]);

  it('a second flashback to the same frame, once the game has moved on, is a flashback again', () => {
    const first = timeline(400, [100, 330]);
    const second = timeline(400, [100, 300]);
    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    const afterFirst = runAll(a, after(first, 201, 300).slice(0, 60));                  // the game plays on to frame 260
    const afterSecond = runAll(a, after(second, 201, 360));
    expect([flashbacks(afterFirst), flashbacks(afterSecond), afterSecond[0]!.flashback?.targetFrameId]).toEqual([1, 1, 200]);
    expect(shown(a.state)).toEqual(sameAs(second));
  });
  it('a report in the frame after the first rewind is still the same flashback; one frame later it is a new one', () => {
    const fork = timeline(400, [100, 330]);
    const continuation = after(fork, 201, 300);
    continuation[1] = withEvents(continuation[1]!, flbk(200));                         // frame 202
    continuation[2] = withEvents(continuation[2]!, flbk(200));                         // frame 203
    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    const results = runAll(a, continuation);
    expect(results.map((r) => r.flashback !== undefined)).toEqual([true, false, true, ...new Array<boolean>(continuation.length - 3).fill(false)]);
  });
  it('a rewind from a frame with an id below the target keeps its guard until the frame after the target', () => {
    const early = timeline(400, [100, 185]);                                           // equals the original up to frame 184
    const continuation = after(early, 185, 300);
    continuation[0] = withEvents(continuation[0]!, flbk(200));                         // frame 185: id below its own target
    continuation[17] = withEvents(continuation[17]!, flbk(200));                       // frame 202: the game reports it again
    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    const results = runAll(a, continuation);
    expect(flashbacks(results)).toBe(1);
    expect(shown(a.state)).toEqual(sameAs(early));
  });
});

describe('SessionRunner: what a rewind keeps', () => {
  const original = () => timeline(300, [100, 250]);
  // a run that only ever saw frames 0..200: what the runner holds for the timeline up to the target
  const upToTarget = () => {
    const control = new SessionRunner(initFor(original()));
    runAll(control, original().slice(0, 201));
    return control.retained;
  };

  it('a second flashback to a frame between the first target and the first flashback point replays frames of both timelines', () => {
    const forkA = timeline(400, [100, 220]);                                           // equals the original up to frame 219
    const forkB = timeline(400, [100, 220, 240]);                                      // equals forkA up to frame 239
    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    expect(flashbacks(runAll(a, after(forkA, 201, 300).slice(0, 59)))).toBe(1);        // forkA up to frame 259
    const results = runAll(a, after(forkB, 231, 400));                                 // back to frame 230
    expect([flashbacks(results), results[0]!.flashback?.targetFrameId]).toEqual([1, 230]);
    expect(shown(a.state)).toEqual(sameAs(forkB));
  });
  it('a rewind on a tick of the undone timeline keeps the snapshots and frames of the target timeline and nothing of that tick', () => {
    const frames = original();
    const a = new SessionRunner(initFor(frames));
    runAll(a, frames);
    applyOne(a, withEvents({ ...frames[200]!, frameId: 300, overallFrameId: 300 }, flbk(200)));
    expect(a.retained).toEqual(upToTarget());
  });

  // frames that differ in id and time only, one second apart unless said otherwise: a snapshot per frame
  const session = (n: number, stepMs: number) => {
    const [first, next] = timeline(2, []);
    return [first!, ...Array.from({ length: n }, (_, k) => ({ ...next!, frameId: k + 1, overallFrameId: k + 1, sessionTime: (k + 1) * stepMs }))];
  };
  it('a late frame with a lower id replaces the kept frames and snapshots from its id on', () => {
    const frames = session(9, 1000);
    const a = new SessionRunner(initFor(frames));
    runAll(a, frames);
    applyOne(a, { ...frames[5]!, overallFrameId: 5 });                                 // not a flashback
    const control = new SessionRunner(initFor(frames));
    runAll(control, frames.slice(0, 6));
    expect(a.retained).toEqual(control.retained);
  });
  it('while session time stands still, a snapshot is due 120 frames after the last one', () => {
    const frames = session(119, 0);
    const r = new SessionRunner(initFor(frames));
    runAll(r, frames.slice(0, 119));
    expect(r.retained.snapshots).toBe(1);
    applyOne(r, frames[119]!);
    expect(r.retained.snapshots).toBe(2);
  });
  it('keeps exactly the frames after the start of the replay window', () => {
    const frames = session(5000, 0);                                                   // snapshots at frame 119, 239, ..., 4919
    const r = new SessionRunner(initFor(frames));
    runAll(r, frames);
    expect(r.retained.frames).toBe(5000 - (4919 - 3600));                              // the window is 3600 frames, it starts at snapshot 1319
  });
});

// C21, C25, C33 (Task M1-R): a fact's id counts the facts of its list before it in the current timeline (the log without
// the voided facts), so a confirmed lap names its provisional by the id a run without the rewind gives it, though the
// log keeps the voided provisional before it.
// C5, C7, C27, C33, inventory 1.10 (the flashback at 496.561, f42053): the game's last tick on the undone timeline carries
// that tick's events and the FLBK; the new timeline's first tick has the target's frame id and the same overall frame id,
// 2.453 s after the target's time. The undone tick rewinds and is never stepped.
describe('SessionRunner: the undone tick of a flashback (C7, C27, C33)', () => {
  /** The target's frame index (race frame 200) and the old timeline's last one (race frame 300). */
  const T = LIGHTS_OUT + 201;
  const U = LIGHTS_OUT + 301;
  const LANDS_MS = 2_453;
  const UNDONE_EVENTS: EventDetails[] = [
    { code: 'PENA', penaltyType: 16, infringementType: 42, vehicleIdx: 0, otherVehicleIdx: 255, time: 255, lapNum: 5, placesGained: 255 },
    ovtk(1, 0),
    scar(1, 0),
    { code: 'DRSD', reason: 1 },
  ];
  /** A race with DRS on from race frame 10; car 0's laps begin at `lapStarts`. */
  const race = (n: number, lapStarts: number[]) => script(gridStart(n, (k) => ({ ...(k === 10 && { events: [{ code: 'DRSE' }] }), cars: drive(lapStarts) })));
  // equal up to frame 299, so past the target
  const original = race(U - LIGHTS_OUT, [100, 200, 300]);
  const fork = race(U - LIGHTS_OUT + 100, [100, 200, 320, 420]);
  const tick = undoneTick(original[U]!, T, { targetMs: original[T]!.sessionTime, before: UNDONE_EVENTS });
  /** The new timeline from frame `from` on, its first tick sharing the overall id `overall`, `landsMs` off the frames' own time. */
  const landed = (from: number, overall: number, landsMs = LANDS_MS) => after(fork, from, overall).map((f) => ({ ...f, sessionTime: f.sessionTime + landsMs }));
  const resumed = landed(T, tick.overallFrameId);
  const ran = (frames: Frame[]) => {
    const r = new SessionRunner(initFor(frames));
    runAll(r, frames);
    return r;
  };
  /** Every span of `machine` readers see: closed and open. */
  const spansOf = (r: SessionRunner, machine: string) => [...(r.state.history.spans[machine] ?? []), ...(situationOf(r.state).byMachine[machine] ?? [])];

  it('the undone tick rewinds and its result says so, but it gets no frame number', () => {
    const a = ran(original);
    const r = applyOne(a, tick);
    expect(r.delta.rewound).toEqual({ frameId: T, at: original[T]!.sessionTime });
    expect(r.flashback?.targetFrameId).toBe(T);
    expect((['laps', 'timing', 'miniSectors'] as const).every((t) => r.changed.has(t))).toBe(true);
    expect([a.state.lastFrameId, a.state.frameNumber]).toEqual([T, T + 1]);
  });
  it('none of the undone tick’s events reach a step: the player stays competing, no neutralisation, DRS stays on, exactly one void', () => {
    const a = ran([...original, tick, ...resumed]);
    expect(spansOf(a, 'car-status').filter((s) => s.carId === 0).map((s) => s.kind)).toEqual(['competing']);
    expect(spansOf(a, 'session-phase-race').filter((s) => s.kind === 'neutralised')).toEqual([]);
    expect(situationOf(a.state).byMachine['race-control-race']?.map((s) => s.kind)).toEqual(['drsOn']);
    expect(spansOf(a, 'race-control-race').filter((s) => s.kind === 'drsOff' && (s.detail as { reason?: string }).reason !== 'notEnabledYet')).toEqual([]);
    expect(a.state.log.voids).toHaveLength(1);
  });
  it('the projection and the state equal a run that never received the undone frames (C33)', () => {
    const a = ran([...original, tick, ...resumed]);
    const reference = ran([...original.slice(0, T + 1), ...resumed]);
    expect(shown(a.state)).toEqual(shown(reference.state));
  });
  it('the flashback report goes with the next stepped frame: a landing below the target’s time is no fall', () => {
    const a = ran([...original, tick, ...landed(T, tick.overallFrameId, -300)]);
    expect(a.state.log.clock).toEqual([]);
  });
  it('the report stays with that frame: a later rewind replays it, and both frames of the target’s id, without a fall', () => {
    const first = landed(T, tick.overallFrameId, -300);
    const played = first.slice(0, 40);
    const second = undoneTick(played.at(-1)!, T + 5, { targetMs: first[5]!.sessionTime });
    const again = landed(T + 5, second.overallFrameId, -300);
    const a = ran([...original, tick, ...played, second, ...again]);
    expect(a.state.log.clock).toEqual([]);
    expect(a.state.log.voids).toHaveLength(2);
    expect(shown(a.state)).toEqual(shown(ran([...original, tick, ...first.slice(0, 6), ...again]).state));
  });
  // Inventory 1.10: the rewind to f56743 came 0.8 s after the one to f56744.
  it('a second flashback to the frame before the first one’s target equals a run without either’s undone frames', () => {
    const played = resumed.slice(0, 45);
    const second = undoneTick(played.at(-1)!, T - 1, { targetMs: original[T - 1]!.sessionTime });
    const again = landed(T - 1, second.overallFrameId, 21);
    const a = ran([...original, tick, ...played, second, ...again]);
    expect(a.state.log.voids).toHaveLength(2);
    expect(shown(a.state)).toEqual(shown(ran([...original.slice(0, T), ...again]).state));
  });
});

// Every real flashback goes 15.000 s back: inside the 30 s replay window, where no snapshot is thinned, so the rewind
// restores the game's target frame exactly.
describe('SessionRunner: a 15 s rewind at 60 Hz (C27, C33)', () => {
  const TARGET = 1_100;
  const LAST = TARGET + 900;
  const race = (frames: number, lapStarts: number[]) => {
    const b = new ScenarioBuilder({ cars: 2, stepMs: 1000 / 60 }).session({ trackLength: 4000 });
    for (let i = 0; i < frames; i++) b.frame(drive(lapStarts));
    return b.build();
  };
  const every100 = (to: number) => Array.from({ length: to / 100 }, (_, k) => 100 * (k + 1));
  const original = race(LAST + 1, every100(LAST));
  const fork = race(TARGET + 200, [...every100(TARGET), TARGET + 50, TARGET + 150]);
  const tick = undoneTick(original[LAST]!, TARGET, { targetMs: original[TARGET]!.sessionTime });
  const resumed = after(fork, TARGET, tick.overallFrameId);

  it('the void target is the game’s target frame, and the projection equals a run that never received the undone frames', () => {
    const a = new SessionRunner(initFor(original));
    runAll(a, original);
    const target = { frameId: TARGET, at: original[TARGET]!.sessionTime };
    expect(applyOne(a, tick).delta.rewound).toEqual(target);
    expect(a.state.log.voids.at(-1)!.target).toEqual(target);
    runAll(a, resumed);
    const frames = [...original.slice(0, TARGET + 1), ...resumed];
    const reference = new SessionRunner(initFor(frames));
    runAll(reference, frames);
    expect(shown(a.state)).toEqual(shown(reference.state));
  });
});

describe('SessionRunner: a confirmed lap names its provisional across a flashback (C21, C25)', () => {
  /** Car 0's laps begin at `lapStarts`; Session History confirms laps 1 and 2 at frame 300. */
  const laps = (frames: number, lapStarts: number[]) => {
    const b = new ScenarioBuilder({ cars: 2, stepMs: STEP }).session({ trackLength: 4000 });
    for (let i = 0; i < frames; i++) {
      b.frame((d) => {
        drive(lapStarts)(d);
        if (i === 300) {
          d.add('sessionHistory', { carIdx: 0, numLaps: 3, lapHistoryData: [
            { lapTimeInMs: 100 * STEP, lapValidBitFlags: 0b1111 }, { lapTimeInMs: 140 * STEP, lapValidBitFlags: 0b1111 }, { lapValidBitFlags: 0b1111 }] });
        }
      });
    }
    return b.build();
  };
  // original: frames 0..259, laps begin at 100 and 230 (lap 2's provisional at 230, after the snapshot of frame 189);
  // the game goes back to frame 200 and lap 2 now ends at 240; a run without the rewind has only the fork's frames
  const original = () => laps(260, [100, 230]);
  const continuation = () => [undoneTick(original().at(-1)!, 200), ...after(laps(320, [100, 240]), 201, 260)];
  const rewound = () => {
    const runner = new SessionRunner(initFor(original()));
    runAll(runner, [...original(), ...continuation()]);
    return runner;
  };
  const straight = () => {
    const frames = laps(320, [100, 240]);
    const runner = new SessionRunner(initFor(frames));
    runAll(runner, frames);
    return runner;
  };
  const summary = (l: DeepReadonly<LapRecord>) => [l.lapNumber, l.status, l.supersedes];

  it('the log keeps the voided provisional; the replayed provisional and its confirmation carry the ids of a run without the rewind', () => {
    const { state } = rewound();
    expect(state.log.voids.at(-1)!.ranges.laps).toEqual([1, 2]);
    expect(state.log.laps.map(summary)).toEqual([
      [1, 'provisional', undefined],
      [2, 'provisional', undefined],
      [2, 'provisional', undefined],
      [1, 'confirmed', { list: 'laps', index: 0 }],
      [2, 'confirmed', { list: 'laps', index: 1 }],
    ]);
    expect(straight().state.log.laps.map(summary)).toEqual([
      [1, 'provisional', undefined],
      [2, 'provisional', undefined],
      [1, 'confirmed', { list: 'laps', index: 0 }],
      [2, 'confirmed', { list: 'laps', index: 1 }],
    ]);
  });
  it('a fact recorded after a void gets the id counted without the voided facts: the confirmed lap 2 names id 1, its provisional at log position 2', () => {
    const { state } = rewound();
    const confirmed = state.log.laps.find((l) => l.lapNumber === 2 && l.status === 'confirmed')!;
    expect(confirmed.supersedes).toEqual({ list: 'laps', index: 1 });
    expect(state.log.laps[2]).toMatchObject({ lapNumber: 2, status: 'provisional', frame: confirmed.frame });
    expect(state.history.laps[1]).toBe(state.log.laps[2]);
  });
  it('the projection’s laps, their references included, equal a run without the rewind (C33)', () => {
    expect(rewound().state.history.laps).toEqual(straight().state.history.laps);
  });
  it('currentLaps keeps exactly the laps no supersedes names (no formation here: a projection lap’s index is its id)', () => {
    for (const { state } of [rewound(), straight()]) {
      const history = state.history.laps as LapRecord[];
      const named = new Set(history.flatMap((l) => (l.supersedes ? [l.supersedes.index] : [])));
      expect([...named]).toEqual([0, 1]);
      expect(currentLaps(history)).toEqual(history.filter((_, id) => !named.has(id)));
    }
  });
});
