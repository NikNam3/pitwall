// A fall of the session time inside the formation phase (the formation reset) is carried over like any fall that is no
// flashback (C36, supervisor ruling Task 7 round 2): it re-times nothing, truncates no step, and the race clock never
// falls over it. On race-zandvoort-clock-reset (facts in fixtures/index.json): the formation lap from 2 s, then the race
// clock from 2 s again, frame ids rising, no FLBK and no lights out in between. The engine alone; one replay feeds every
// test.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Projection, StepResult } from '@pitwall/engine';
import { replayRunner } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

/** The fact lists a fall could re-time (C24: a recorded fact is never changed). */
type Facts = Pick<Projection, 'events' | 'crossings'>;

const run: {
  /** The step whose session time (the game's) fell by more than 1 s, and the log's facts as stored just before it. */
  fall: { result: StepResult; before: Facts } | undefined;
  /** Whether any step was truncated. */
  truncated: boolean[];
  /** The race clock after every step. */
  raceClock: number[];
  /** The kinds of the clock facts of the log at the end. */
  clockKinds: string[];
  phases: string[];
} = { fall: undefined, truncated: [], raceClock: [], clockKinds: [], phases: [] };

beforeAll(async () => {
  let previous: { raw: number; log: Facts } | undefined;
  const runner = await replayRunner(segmentPath('race-zandvoort-clock-reset.pwrec.gz'), (r, f) => {
    if (run.fall === undefined && previous !== undefined && f.sessionTime < previous.raw - 1000) run.fall = { result: r, before: previous.log };
    run.truncated.push(r.delta.rewound !== undefined);
    run.raceClock.push(r.state.sessionTime);
    previous = { raw: f.sessionTime, log: structuredClone({ events: r.state.log.events, crossings: r.state.log.crossings }) };
  });
  run.clockKinds = runner.state.log.clock.map((c) => c.kind);
  // The session's end closes every open span (C18): the race's session phases are then all in the projection.
  runner.finish();
  run.phases = (runner.state.history.spans['session-phase-race'] ?? []).map((s) => `${s.kind}${s.joinedAt ? ' (joined)' : ''} until ${s.endFrame === runner.state.frameNumber + 1 ? 'the end' : s.endFrame}`);
});

describe('a fall inside the formation phase is carried over (the formation reset, C36)', () => {
  it('no step is truncated, no flashback is reported, and the fall is a fall fact', () => {
    expect(run.truncated.filter(Boolean)).toEqual([]);
    expect(run.fall!.result.flashback).toBeUndefined();
    expect(run.clockKinds).toEqual(['fall']);
  });
  it('the race clock never falls over it', () => {
    expect(run.raceClock.filter((t, i) => i > 0 && t < run.raceClock[i - 1]!)).toEqual([]);
  });
  it('the facts recorded before the fall stay as they were in the log as stored (C24); the formation span hides them (C29)', () => {
    const { result, before } = run.fall!;
    const { log, history } = result.state;
    expect({ events: log.events.slice(0, before.events.length), crossings: log.crossings.slice(0, before.crossings.length) })
      .toEqual({ events: before.events, crossings: before.crossings });
    expect(before.crossings.length).toBeGreaterThan(0);
    expect(history.crossings).toEqual([]);
  });
  it('the formation span stays open: without a start light nothing closes it before the session’s end', () => {
    expect(run.phases).toEqual(['formation (joined) until the end']);
  });
});
