// The scheduler's `view.priors` (contract C27a, C33, C39, C62a; spec 3.3, 3.4): built once per pass from the projection's
// decisions and the run's priors (`priorsOf(input.history.decisions, input.priors)`). A unit that reads the priors
// declares `decisions` and runs every frame, so it runs on the frame of a pick with the picked snapshot and, after a
// flashback voids the pick, with the start snapshot again. The scenario: the runner tests' timeline; the session starts on
// snapshot A, the user picks B with frame 150, and the game flashes back to frame 100.
import { describe, expect, it } from 'vitest';
import { SessionRunner, type EngineView, type StepResult } from '../../src/index.ts';
import { applyWith, PICK_B, priorsValue, runPriors, SNAP_A, SNAP_B } from '../support/decisions.ts';
import { initFor } from '../support/run.ts';
import { after, timeline } from '../support/runner.ts';
import { inputOf, quick, sched } from '../support/scheduler.ts';

const PICK_AT = 150;

describe('the scheduler\'s view.priors (C62a)', () => {
  it('the scheduler\'s view.priors follows the projection', () => {
    const frames = timeline(300, [100, 250]);
    const scheduler = sched([quick('priors-reader', { reads: ['decisions'], cadence: 'frame', compute: (v: EngineView) => v.priors })]);
    const runner = new SessionRunner(initFor(frames), { attach: scheduler });
    const seen: Array<{ frameId: number; rewound: boolean; ran: boolean; priors: ReturnType<typeof priorsValue> }> = [];
    const onResult = (r: StepResult, frame: { frameId: number }) => {
      const { ran, outputs, errors } = scheduler.run(inputOf(r, { priors: runPriors('A') }));
      expect(errors).toEqual([]);
      seen.push({ frameId: frame.frameId, rewound: r.delta.rewound !== undefined, ran: ran.includes('priors-reader'), priors: priorsValue(outputs.get('priors-reader') as EngineView['priors']) });
    };
    frames.forEach((f, i) => applyWith(runner, f, i === PICK_AT ? [PICK_B] : undefined, onResult));
    expect(seen[0]).toMatchObject({ ran: true, priors: SNAP_A });
    expect(seen[PICK_AT - 1]).toMatchObject({ priors: SNAP_A });
    expect(seen[PICK_AT]).toMatchObject({ frameId: PICK_AT, ran: true, priors: SNAP_B });
    expect(seen.at(-1)).toMatchObject({ priors: SNAP_B });

    // the flashback to frame 100 voids the pick (C27a): the reader runs on it with the start snapshot again (C33)
    const fork = after(timeline(400, [100, 330]), 101, 300);
    const before = seen.length;
    for (const f of fork) applyWith(runner, f, undefined, onResult);
    const rewinding = seen[before]!;
    expect(rewinding).toMatchObject({ rewound: true, ran: true, priors: SNAP_A });
    expect(seen.slice(before).map((s) => s.priors)).toEqual(fork.map(() => SNAP_A));
    expect(runner.state.history.decisions).toEqual([]);
  });
});
