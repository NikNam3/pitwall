// A fall of the session time inside the formation phase changes nothing (the formation reset, spec 3.3: lights out
// discards the formation lap, so the fall needs nothing itself and is no clock fall), on race-zandvoort-clock-reset
// (facts in fixtures/index.json): the formation lap from 2 s, then the race clock from 2 s again, frame ids rising, no
// FLBK and no lights out in between. The engine alone; one replay feeds every test.
import { beforeAll, describe, expect, it } from 'vitest';
import type { History, StepResult } from '@pitwall/engine';
import { replayRunner } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

const run: {
  /** The step whose session time fell by more than 1 s, and the history just before it. */
  fall: { result: StepResult; before: History } | undefined;
  /** Whether any step was truncated. */
  truncated: boolean[];
  /** Every clock fall a step reported. */
  clockFalls: NonNullable<StepResult['clockFall']>[];
  phases: string[];
} = { fall: undefined, truncated: [], clockFalls: [], phases: [] };

beforeAll(async () => {
  let previous: { at: number; history: History } | undefined;
  const runner = await replayRunner(segmentPath('race-zandvoort-clock-reset.pwrec.gz'), (r) => {
    const now = r.state.sessionTime;
    if (run.fall === undefined && previous !== undefined && now < previous.at - 1000) run.fall = { result: r, before: previous.history };
    run.truncated.push(r.delta.truncated);
    if (r.clockFall) run.clockFalls.push(r.clockFall);
    previous = { at: now, history: structuredClone(r.state.history) as History };
  });
  run.phases = [...runner.state.history.sessionPhases, runner.state.open.situations.session].map((p) => p.kind);
});

describe('a fall inside the formation phase changes nothing (the formation reset, spec 3.3)', () => {
  it('no step is truncated, no flashback and no clock fall is reported', () => {
    expect(run.truncated.filter(Boolean)).toEqual([]);
    expect(run.fall!.result.flashback).toBeUndefined();
    expect(run.clockFalls).toEqual([]);
  });
  it('the history recorded before the fall stays as it was', () => {
    const { result, before } = run.fall!;
    const h = result.state.history;
    expect({ events: h.events.slice(0, before.events.length), miniSectors: h.miniSectors.slice(0, before.miniSectors.length) })
      .toEqual({ events: before.events, miniSectors: before.miniSectors });
    expect(before.miniSectors.length).toBeGreaterThan(0);
  });
  it('the formation phase stays open: without lights out nothing closes it', () => {
    expect(run.phases).toEqual(['formation']);
  });
});
