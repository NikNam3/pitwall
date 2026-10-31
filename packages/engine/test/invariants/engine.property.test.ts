import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SessionRunner, type Frame, type StepResult } from '../../src/index.ts';
import { arbRace, NO_PHASES, raceFrames, type RaceParams } from '../support/arb-race.ts';
import { InvariantChecker } from '../support/invariants.ts';
import { initFor } from '../support/run.ts';
import { expectScheduledIncremental, underNeutralisation } from '../support/scheduler.ts';

const run = (frames: Frame[], each?: (r: StepResult) => void) => {
  const runner = new SessionRunner(initFor(frames));
  for (const f of frames) {
    // applied whether or not `each` is given: an optional call skips evaluating its argument
    const result = runner.apply(f);
    each?.(result);
  }
  return runner;
};
const OPTS = { numRuns: 40 };

// The generated races carry optional session-phase beats (review 2 B5): a start with lights, perhaps after a formation
// lap; a neutralisation confirmed, dropped unconfirmed or opened by the status alone; a red flag; a mid-race clock fall.
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

  // Every race runs the whole 300 frames here, so a deployment the status never confirms reaches its 3 s expiry.
  it('a reader of the history and the open phase is incremental = from scratch under the scheduler, across every phase beat and flashback', () => {
    fc.assert(
      fc.property(arbRace, (p) => {
        expectScheduledIncremental(underNeutralisation, raceFrames({ ...p, frames: 300 }).frames);
      }),
      { numRuns: 25 },
    );
  });

  // Wave 5 (W5-E): the counterexample the property found (seed 1759405573), kept as it was found. Two rewinds 4 frames
  // apart; the second one's stale frames bring the SC status, which opens the neutralisation at the moment of its
  // target, where the target frame already crossed a mini-sector. The hand-shrunk case: situations/session-phase.test.ts.
  it('the counterexample of seed 1759405573: two rewinds back to back, the second one’s stale frame opening a neutralisation, keep the reader incremental = from scratch', () => {
    const p: RaceParams = {
      cars: 1, frames: 66, speeds: [15, 15, 15, 15, 15, 15], jitter: [0], truncation: [0],
      flashback: { at: 20, back: 3, viaEvent: false, stale: 0, then: { after: 4, back: 3, viaEvent: false, stale: 1 } },
      phases: { ...NO_PHASES, neutralisation: { car: 1, at: 21, signal: 'statusOnly', confirmAfter: 5, resumeAfter: undefined } },
    };
    expectScheduledIncremental(underNeutralisation, raceFrames({ ...p, frames: 300 }).frames);
  });
});
