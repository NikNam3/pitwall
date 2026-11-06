// The decision recorder (contract C10, C22, C26, C40, C76; spec 3.4): a decision the user committed enters the engine
// with the frame it was committed at, and the recorder appends it as a `decisions` fact describing that frame; the
// frame's change tags then hold `decisions`. A frame without a decision appends none. The scenario is the runner tests'
// timeline (two cars, car 0 drives laps); decisions are given through `SessionRunner.apply`.
import { describe, expect, it } from 'vitest';
import { SessionRunner, type StepResult } from '../../src/index.ts';
import { applyWith, PICK_B, type GivenDecision } from '../support/decisions.ts';
import { initFor } from '../support/run.ts';
import { timeline } from '../support/runner.ts';

/** Runs `frames` frames, giving `decisions[i]` with frame i; each applied frame's result with its frame number. */
const runWith = (frames: number, decisions: Readonly<Record<number, readonly GivenDecision[]>> = {}) => {
  const fs = timeline(frames, [100]);
  const runner = new SessionRunner(initFor(fs));
  const results: Array<{ frameNumber: number; result: StepResult }> = [];
  fs.forEach((f, i) => applyWith(runner, f, decisions[i], (result) => results.push({ frameNumber: result.state.frameNumber, result })));
  return { runner, results };
};

describe('the decision recorder (C10, C76)', () => {
  it('a decision given with a frame is a decisions fact describing that frame', () => {
    const { runner, results } = runWith(150, { 120: [PICK_B] });
    const at = results[120]!;
    expect(runner.state.history.decisions).toEqual([{ ...PICK_B, frame: at.frameNumber }]);
    expect(runner.state.log.decisions).toEqual([{ ...PICK_B, frame: at.frameNumber }]);
    expect(at.result.changed.has('decisions')).toBe(true);
    // only the frame it was committed with appended one
    expect(results.filter((r) => r.result.changed.has('decisions')).map((r) => r.frameNumber)).toEqual([at.frameNumber]);
    expect([at.result.delta.before['decisions'], at.result.delta.after['decisions']]).toEqual([0, 1]);
  });

  it('no decision, no fact and no tag', () => {
    const { runner, results } = runWith(150);
    expect(runner.state.log.decisions).toEqual([]);
    expect(runner.state.history.decisions).toEqual([]);
    expect(results.filter((r) => r.result.changed.has('decisions'))).toEqual([]);
  });
});
