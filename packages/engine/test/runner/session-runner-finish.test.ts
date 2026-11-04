// SessionRunner.finish (Task 27): the session is over. It applies the held frames, closes every open span and hands out
// the closing result, so the bridge's storage writes the closing spans before it marks the session complete (C24, C61)
// and the situation topics publish them (C54).
import { describe, expect, it } from 'vitest';
import { projectionLengths, SessionRunner, situationOf, type DeepReadonly, type EngineState, type Frame, type StepResult } from '../../src/index.ts';
import { initFor } from '../support/run.ts';
import { runAll, timeline } from '../support/runner.ts';

/** The machines with at least one open span now, as their `spans:<machine>` change tags. */
const openSpanTags = (runner: SessionRunner): string[] =>
  Object.entries(situationOf(runner.state).byMachine)
    .filter(([, spans]) => spans.length > 0)
    .map(([machine]) => `spans:${machine}`)
    .sort();

/** The length of every span list of the log, by `spans:<machine>`. */
const spanListLengths = (state: DeepReadonly<EngineState>): Record<string, number> =>
  Object.fromEntries(Object.entries(state.log.spans).map(([machine, spans]) => [`spans:${machine}`, spans.length]));

/** The span lists of the log that grew between two `spanListLengths`. */
const grownSpanLists = (before: Record<string, number>, after: Record<string, number>): string[] =>
  Object.keys(after)
    .filter((list) => (after[list] ?? 0) > (before[list] ?? 0))
    .sort();

describe('SessionRunner.finish: the closing result', () => {
  it('returns the state, the span tags of every machine it closed spans of, the projection delta and no corrections', () => {
    const frames = timeline(120, [60]);
    const runner = new SessionRunner(initFor(frames));
    runAll(runner, frames);
    const open = openSpanTags(runner);
    expect(open).toContain('spans:clock');
    expect(open).toContain('spans:car-status');
    const projectionBefore = projectionLengths(runner.state.history);
    const logBefore = spanListLengths(runner.state);

    const result: StepResult = runner.finish();

    expect(result.state).toBe(runner.state);
    expect([...result.changed].sort()).toEqual(open);
    expect(grownSpanLists(logBefore, spanListLengths(runner.state))).toEqual(open);
    expect(result.delta).toEqual({ before: projectionBefore, after: projectionLengths(runner.state.history) });
    expect(result.delta.rewound).toBeUndefined();
    expect(result.corrections).toEqual([]);
  });

  it('after it no span is open and the projection holds every span it closed', () => {
    const frames = timeline(120, [60]);
    const runner = new SessionRunner(initFor(frames));
    runAll(runner, frames);
    const open = Object.values(situationOf(runner.state).byMachine).flat();
    const { state } = runner.finish();
    expect(Object.values(situationOf(state).byMachine).flat()).toEqual([]);
    for (const span of open) {
      expect(state.history.spans[span.machine], span.machine).toContainEqual(expect.objectContaining({ machine: span.machine, id: span.id, kind: span.kind, ...(span.carId !== undefined && { carId: span.carId }) }));
    }
  });

  it('applies the held frames through onResult first; the closing result is returned, not handed to onResult', () => {
    // no Participants: every frame is held until the session ends
    const frames = timeline(10, []).map(({ participants: _participants, ...f }): Frame => f);
    const runner = new SessionRunner(initFor(frames));
    const handed: number[] = [];
    for (const f of frames) runner.apply(f, (_r, applied) => handed.push(applied.frameId));
    expect(handed).toEqual([]);
    const result = runner.finish((_r, applied) => handed.push(applied.frameId));
    expect(handed).toEqual(frames.map((f) => f.frameId));
    expect(result.state.lastFrameId).toBe(frames.at(-1)!.frameId);
    expect([...result.changed].every((tag) => tag.startsWith('spans:'))).toBe(true);
    expect(result.changed.size).toBeGreaterThan(0);
  });
});
