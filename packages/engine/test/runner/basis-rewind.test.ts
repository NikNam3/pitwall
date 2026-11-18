// SP4.3e Task 0b (C27a, C28, C33, C62): `view.basis` comes from the projection, so a flashback before a `basisChosen`
// decision voids it and the view's basis is the session-start one again, equal to a run that never received the undone
// frames; a flashback after the decision keeps it. The scenario: the runner tests' timeline, frames 0..299 with laps from
// 100 and 250; the game flashes back (frame ids drop while the overall frame id rises) into a fork.
import { describe, expect, it } from 'vitest';
import type { Frame } from '../../src/index.ts';
import { after, timeline } from '../support/runner.ts';
import { A, B, BASIS_B, basisRunner, choose, runNoting } from '../support/basis.ts';

const original = () => timeline(300, [100, 250]);
const fork = () => timeline(400, [100, 330]);

/** The original timeline with the decision at frame index `at`, flashed back to `target`, run on to the fork's end; and the run without the undone frames. */
const rewound = (at: number, target: number) => {
  const frames: Frame[] = original();
  const runner = basisRunner(frames);
  runNoting(runner, frames, (i) => (i === at ? [choose(BASIS_B)] : undefined));
  const seen = runNoting(runner, after(fork(), target + 1, 300));
  const reference = basisRunner(fork());
  const referenceSeen = runNoting(reference, fork(), (i) => (i === at && at <= target ? [choose(BASIS_B)] : undefined));
  return { runner, reference, seen, referenceSeen };
};

describe('SessionRunner: view.basis across a flashback (C27a, C33)', () => {
  it('a rewind before the decision voids it: the start basis again, as in a run without the undone frames', () => {
    const { runner, reference, seen, referenceSeen } = rewound(150, 100);
    expect(runner.state.history.decisions).toEqual([]);
    for (const [frameId, basis] of seen) {
      expect(basis).toEqual(A);
      expect(basis).toEqual(referenceSeen.get(frameId));
    }
    expect(runner.state.basis).toEqual(reference.state.basis);
  });

  it('a rewind after the decision keeps it', () => {
    const { runner, reference, seen } = rewound(95, 100);
    for (const basis of seen.values()) expect(basis).toEqual(B);
    expect(runner.state.basis).toEqual(B);
    expect(reference.state.basis).toEqual(B);
  });
});
