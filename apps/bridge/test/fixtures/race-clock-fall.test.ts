// A fall of the session time that is no race start changes nothing (spec 3.3, "any other fall"), on
// race-zandvoort-clock-reset (facts in fixtures/index.json): the formation lap from 2 s, then the race from 2 s again,
// frame ids rising, no FLBK and no lights out in between. The engine alone; one replay feeds every test.
import { beforeAll, describe, expect, it } from 'vitest';
import type { History, StepResult } from '@pitwall/engine';
import { replayRunner } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

const run: {
  /** The step whose session time fell by more than 1 s, and the history just before it. */
  fall: { result: StepResult; before: History } | undefined;
  /** Whether any step was truncated. */
  truncated: boolean[];
  phases: string[];
} = { fall: undefined, truncated: [], phases: [] };

beforeAll(async () => {
  let previous: { at: number; history: History } | undefined;
  const runner = await replayRunner(segmentPath('race-zandvoort-clock-reset.pwrec.gz'), (r) => {
    const now = r.state.sessionTime;
    if (run.fall === undefined && previous !== undefined && now < previous.at - 1000) run.fall = { result: r, before: previous.history };
    run.truncated.push(r.delta.truncated);
    previous = { at: now, history: structuredClone(r.state.history) as History };
  });
  run.phases = [...runner.state.history.sessionPhases, runner.state.open.situations.session].map((p) => p.kind);
});

describe('race-zandvoort-clock-reset: the session time falls back without a start in between', () => {
  it('no step is truncated and no flashback is reported', () => {
    expect(run.truncated.filter(Boolean)).toEqual([]);
    expect(run.fall!.result.flashback).toBeUndefined();
  });
  it('the history recorded before the fall stays as it was', () => {
    const { result, before } = run.fall!;
    const h = result.state.history;
    expect({ events: h.events.slice(0, before.events.length), miniSectors: h.miniSectors.slice(0, before.miniSectors.length) })
      .toEqual({ events: before.events, miniSectors: before.miniSectors });
    expect(before.miniSectors.length).toBeGreaterThan(0);
  });
  it('without lights out no phase reaches racing', () => {
    expect(run.phases).not.toContain('racing');
  });
});
