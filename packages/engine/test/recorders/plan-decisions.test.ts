// SP4.3b Task 17, the decision recorder and plan decisions (C10, C22, C26, C27a, C76; spec §8.2): `planCommitted
// { carId, policy }` and `planCleared { carId }` enter the engine with the frame they were committed at, and the recorder
// appends each as a `decisions` fact describing that frame, the policy whole; `latestPlan` reads the car's plan from the
// projection. A flashback past a commit voids it like any fact (C27a). The scenario is the runner tests' timeline.
import { carId, latestPlan as latestPlanOf, type DecisionRecord, type Policy } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { SessionRunner, type Frame, type StepResult } from '../../src/index.ts';
import { applyWith, PICK_B, type GivenDecision } from '../support/decisions.ts';
import { initFor } from '../support/run.ts';
import { after, timeline } from '../support/runner.ts';

const CAR = carId(0);
/** `latestPlan` over the runner's read-only projection (the domain helper takes plain records, as `currentLaps` does). */
const latestPlan = (history: { readonly decisions: readonly unknown[] }, car: typeof CAR): Policy | null =>
  latestPlanOf(history as { decisions: readonly DecisionRecord[] }, car);
const POLICY: Policy = {
  stops: [{ lap: 18, compound: 'hard' }],
  triggers: [
    { kind: 'neutralised', condition: 'vsc', fromLap: 8, toLap: 30, action: 'stayOut' },
    { kind: 'rivalPits', carId: carId(1), withinMs: 1_500, action: 'extend' },
    { kind: 'degradationOff', wearRateDeltaPct: 20, action: { switchTo: [{ lap: 24, compound: 'medium' }] } },
  ],
};
const TWO_STOP: Policy = { stops: [{ lap: 12, compound: 'medium' }, { lap: 30, compound: 'soft' }], triggers: [] };
const commit = (policy: Policy): GivenDecision => ({ kind: 'planCommitted', carId: CAR, policy });
const CLEAR: GivenDecision = { kind: 'planCleared', carId: CAR };

/** Runs `frames` with `decisions[i]` given with frame index i; per frame index its frame number and result. */
const runWith = (frames: Frame[], decisions: Readonly<Record<number, readonly GivenDecision[]>> = {}) => {
  const runner = new SessionRunner(initFor(frames));
  const results: Array<{ frameNumber: number; result: StepResult; plan: Policy | null }> = [];
  frames.forEach((f, i) =>
    applyWith(runner, f, decisions[i], (result) =>
      results.push({ frameNumber: result.state.frameNumber, result, plan: latestPlan(runner.state.history, CAR) })),
  );
  return { runner, results };
};

describe('the decision recorder: plan decisions (C10, C76)', () => {
  it('a committed plan is recorded at its frame, with its whole policy, and latestPlan returns it', () => {
    const { runner, results } = runWith(timeline(150, [100]), { 60: [commit(POLICY)], 120: [PICK_B] });
    const at = results[60]!;
    expect(runner.state.history.decisions).toEqual([
      { kind: 'planCommitted', carId: CAR, policy: POLICY, frame: at.frameNumber },
      { ...PICK_B, frame: results[120]!.frameNumber },
    ]);
    expect(at.result.changed.has('decisions')).toBe(true);
    expect(latestPlan(runner.state.history, CAR)).toEqual(POLICY);
    // none before its frame, the policy from it on
    expect(results.slice(0, 60).every((r) => r.plan === null)).toBe(true);
    expect(results.slice(60).every((r) => JSON.stringify(r.plan) === JSON.stringify(POLICY))).toBe(true);
  });

  it('a later commit replaces it; planCleared makes latestPlan null', () => {
    const { runner, results } = runWith(timeline(150, [100]), { 40: [commit(POLICY)], 80: [commit(TWO_STOP)], 120: [CLEAR] });
    expect(runner.state.history.decisions.map((d) => [d.kind, d.frame])).toEqual([
      ['planCommitted', results[40]!.frameNumber],
      ['planCommitted', results[80]!.frameNumber],
      ['planCleared', results[120]!.frameNumber],
    ]);
    expect(results[79]!.plan).toEqual(POLICY);
    expect(results[80]!.plan).toEqual(TWO_STOP);
    expect(results[119]!.plan).toEqual(TWO_STOP);
    expect(results[120]!.plan).toBeNull();
    expect(latestPlan(runner.state.history, CAR)).toBeNull();
  });

  it('a flashback past the commit voids it (C27a)', () => {
    // the original timeline with the commit at frame 150, flashed back to frame 100 and run on to the end of the fork
    const { runner } = runWith(timeline(300, [100, 250]), { 150: [commit(POLICY)] });
    expect(latestPlan(runner.state.history, CAR)).toEqual(POLICY);
    for (const f of after(timeline(400, [100, 330]), 101, 300)) applyWith(runner, f);
    expect(latestPlan(runner.state.history, CAR)).toBeNull();
    expect(runner.state.history.decisions).toEqual([]);
    // nothing is removed: the decision stays in the log, a void covers it, and the projection equals a run without it
    expect(runner.state.log.decisions).toHaveLength(1);
    expect(runner.state.log.voids.map((v) => v.ranges['decisions'])).toEqual([[0, 1]]);
    expect(runner.state.history).toEqual(runWith(timeline(400, [100, 330])).runner.state.history);
  });
});
