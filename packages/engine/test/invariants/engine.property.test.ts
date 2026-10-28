import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SessionRunner, type Frame, type StepResult } from '../../src/index.ts';
import { arbRace, raceFrames } from '../support/arb-race.ts';
import { InvariantChecker } from '../support/invariants.ts';
import { initFor } from '../support/run.ts';

const run = (frames: Frame[], each?: (r: StepResult) => void) => {
  const runner = new SessionRunner(initFor(frames));
  for (const f of frames) each?.(runner.apply(f));
  return runner;
};
const OPTS = { numRuns: 40 };

describe('engine invariants (spec 10.2)', () => {
  it('positions, monotone laps, growing history, sector sums and unique crossings hold on every step', () => {
    fc.assert(
      fc.property(arbRace, (p) => {
        const c = new InvariantChecker();
        run(raceFrames(p).frames, (r) => c.check(r));
      }),
      OPTS,
    );
  });

  it('a flashback (FLBK, or frameId going back) yields the state of a run that never had the discarded frames', () => {
    fc.assert(
      fc.property(arbRace, (p) => {
        const { frames, reference } = raceFrames(p);
        expect(run(frames).state).toEqual(run(reference).state);
      }),
      OPTS,
    );
  });

  it('is deterministic: the same frames give the same state and the same results', () => {
    fc.assert(
      fc.property(arbRace, (p) => {
        const { frames } = raceFrames(p);
        const trace = (out: unknown[]) => (r: StepResult) =>
          out.push({ changed: [...r.changed].sort(), delta: r.delta, flashback: r.flashback, corrections: r.corrections });
        const a: unknown[] = [];
        const b: unknown[] = [];
        expect(run(frames, trace(a)).state).toEqual(run(frames, trace(b)).state);
        expect(a).toEqual(b);
      }),
      OPTS,
    );
  });
});
