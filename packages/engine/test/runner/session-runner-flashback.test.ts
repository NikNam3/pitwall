// SessionRunner: how a flashback is recognised and reported once, the void fact it appends (C27), the attached
// bookkeeping it restores, and what a rewind keeps. Every frame of the scenarios here carries a race event, so a frame
// replayed twice or lost in a replay shows in the history.
import { describe, expect, it } from 'vitest';
import { feedId, toSessionTime, type Insight } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import {
  activeFlagPhaseOf,
  CalculatorRegistry,
  Scheduler,
  SessionRunner,
  situationOf,
  type Frame,
  type InsightChange,
  type QuickCalculator,
  type Snapshotable,
  type StepResult,
} from '../../src/index.ts';
import { buildPacket, ScenarioBuilder } from '../builders/index.ts';
import { IDLE_FEED } from '../helpers/incremental.ts';
import { initFor } from '../support/run.ts';
import { after, applyOne, factLengths, factLists, flashbacks, flbk, runAll, shown, STEP, timeline as plainTimeline } from '../support/runner.ts';

const overtake: EventDetails = { code: 'OVTK', overtakingVehicleIdx: 0, beingOvertakenVehicleIdx: 1 };
/** The shared timeline with an overtake in every frame, before the events `extra` names for its index. */
const timeline = (frames: number, lapStarts: number[], extra: (index: number) => EventDetails[] = () => []) =>
  plainTimeline(frames, lapStarts, (i) => [overtake, ...extra(i)]);
const eventsOf = (details: EventDetails) =>
  new ScenarioBuilder({ cars: 2, stepMs: STEP }).session({ trackLength: 4000 }).frames(1, () => {}).event(details).frames(1, () => {}).build()[1]!.events;
const withEvents = (frame: Frame, details: EventDetails): Frame => ({ ...frame, events: [...frame.events, ...eventsOf(details)] });
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
    compute: (v) => v.state.cars[0]!.timing.lap,
    insights: (lap) => [...(lap >= 2 ? [insight('lap2')] : []), ...(lap >= 3 ? [insight('lap3')] : [])],
  };

  it('after a flashback the scheduler’s bookkeeping is the snapshot’s: an insight raised after the target is gone, one raised before it stays', () => {
    const scheduler = new Scheduler(CalculatorRegistry.build([lapProbe]));
    scheduler.setNeeded([lapProbe.id]);
    const runner = new SessionRunner(initFor(original()), { attach: scheduler });
    const changes: InsightChange[] = [];
    let atRewind: Insight[] | undefined;
    const schedule = (r: StepResult) => {
      if (r.delta.rewound !== undefined) atRewind = scheduler.activeInsights;
      const input = { state: r.state, activeFlagPhase: activeFlagPhaseOf(r.state), situation: situationOf(r.state), changed: r.changed, delta: r.delta, feed: IDLE_FEED, config: {} };
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
  it('a rewind from a frame with a high id keeps the snapshots and frames of the target timeline and that frame only', () => {
    const frames = original();
    const a = new SessionRunner(initFor(frames));
    runAll(a, frames);
    applyOne(a, withEvents({ ...frames[200]!, frameId: 300, overallFrameId: 300 }, flbk(200)));
    expect(a.retained).toEqual({ snapshots: upToTarget().snapshots, frames: upToTarget().frames + 1 });
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
    expect(r.retained.frames).toBe(5000 - (4919 - 1200));                              // the window is 1200 frames, it starts at snapshot 3719
  });
});
