// SessionRunner and decisions (contract C10, C27, C27a, C33, C76; spec 3.4): the runner keeps the decisions given with a
// frame with that frame and gives them again when a rewind replays it, so only the frames up to the target bring their
// decisions back. A rewind to a frame before a decision voids it (a void range over its position, nothing removed); a
// rewind after it keeps it, once. The log keeps decisions by its lengths in every snapshot, so a restore leaves a
// decision before the snapshot as it is. The scenario: the runner tests' timeline, frames 0..299 with laps from 100 and
// 250; the game flashes back (frame ids drop while the overall frame id rises) into a fork whose lap 3 begins at 330.
import { describe, expect, it } from 'vitest';
import { SessionRunner, type Frame } from '../../src/index.ts';
import { applyWith, PICK_B, type GivenDecision } from '../support/decisions.ts';
import { initFor } from '../support/run.ts';
import { after, timeline } from '../support/runner.ts';

const original = () => timeline(300, [100, 250]);
const fork = () => timeline(400, [100, 330]);

/** A runner over `frames`, `decision` given with frame index `at`; the frame number each frame index was applied as. */
const runWith = (frames: Frame[], at: number, decision: GivenDecision = PICK_B) => {
  const runner = new SessionRunner(initFor(frames));
  const frameNumbers = new Map<number, number>();
  for (const [i, f] of frames.entries()) {
    applyWith(runner, f, i === at ? [decision] : undefined, (r, applied) => frameNumbers.set(applied.frameId, r.state.frameNumber));
  }
  return { runner, frameNumbers };
};

/**
 * The original timeline with the decision at frame index `at`, flashed back to frame `target` and run on to the end of
 * the fork; and the run that never had the undone frames: the fork alone, with the decision when `at` is at or before
 * the target (C27a).
 */
const rewound = (at: number, target: number) => {
  const { runner, frameNumbers } = runWith(original(), at);
  for (const f of after(fork(), target + 1, 300)) applyWith(runner, f);
  const reference = runWith(fork(), at <= target ? at : -1).runner;
  return { runner, reference, frameNumbers };
};

describe('SessionRunner: decisions across a flashback (C27, C27a)', () => {
  it('a rewind before the decision voids it (C27a)', () => {
    const { runner, reference } = rewound(150, 100);
    expect(runner.state.history.decisions).toEqual([]);
    // nothing is removed: the decision stays in the log, and a void fact covers its position
    expect(runner.state.log.decisions).toHaveLength(1);
    expect(runner.state.log.voids.map((v) => v.ranges['decisions'])).toEqual([[0, 1]]);
    expect(runner.state.history).toEqual(reference.state.history);
  });

  it('a rewind after the decision keeps it', () => {
    // the snapshot restored is the one before frame 95 (one per 1000 ms of session time), so frame 95 is replayed
    const { runner, reference, frameNumbers } = rewound(95, 100);
    expect(runner.state.history.decisions).toEqual([{ ...PICK_B, frame: frameNumbers.get(95) }]);
    // the replayed kept frame carried it again, after the void
    expect(runner.state.log.decisions).toHaveLength(2);
    expect(runner.state.log.voids.map((v) => v.ranges['decisions'])).toEqual([[0, 1]]);
    expect(runner.state.history).toEqual(reference.state.history);
  });

  it('the decisions list survives a snapshot round trip', () => {
    // the decision at frame 30 lies before the snapshot the rewind to frame 200 restores: the snapshot's log lengths
    // hold it, so the void starts after it and no replay gives it again
    const { runner, reference, frameNumbers } = rewound(30, 200);
    expect(runner.state.log.decisions).toEqual([{ ...PICK_B, frame: frameNumbers.get(30) }]);
    expect(runner.state.log.voids).toHaveLength(1);
    expect(runner.state.log.voids[0]!.ranges['decisions']).toBeUndefined();
    expect(runner.state.history.decisions).toEqual([{ ...PICK_B, frame: frameNumbers.get(30) }]);
    expect(runner.state.history).toEqual(reference.state.history);
  });
});
