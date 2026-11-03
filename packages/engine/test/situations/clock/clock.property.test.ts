// The clock's property (contract C7, C15, C26, C36, C85): step 0's clock is a sub-machine outside the registry, so it
// gets its own property on the invariants every sub-machine keeps (`test/support/machine-invariants.ts`). Random clock
// sequences (session time steps with falls and forward jumps up to the simulated end and beyond, receive-time gaps over
// and under 2 s, `gamePaused` toggles, online and offline, flashback reports) never give an undeclared transition, a
// throw or two open paused spans; the complete span list (the pause still open closed after the last frame, as
// `closeSession` does) is contiguous per C26 (a pause may open and close on one frame) and its ids count; and the race
// clock never falls but on a frame the runner reported as a flashback.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Span } from '@pitwall/domain';
import { STEP0_CLOCK } from '../../../src/situations/clock/clock.ts';
import { PAUSE_AFTER_WALL_MS } from '../../../src/situations/clock/pauses.ts';
import { SIMULATION_JUMP_MS } from '../../../src/situations/clock/jumps.ts';
import { clockInputs, clockStepper, type ClockFrame } from '../../support/clock-inputs.ts';
import { frameProblems, spanListProblems } from '../../support/machine-invariants.ts';
import { FRAME_MS } from '../../support/transition-table.ts';

/** How the session time moves from one frame to the next: on, held, a small or large fall, a forward jump, a simulation. */
const arbAdvance = fc.oneof(
  { weight: 12, arbitrary: fc.constant(FRAME_MS) },
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 2, arbitrary: fc.integer({ min: -5_000, max: -1 }) },
  { weight: 1, arbitrary: fc.integer({ min: -600_000, max: -5_001 }) },
  { weight: 1, arbitrary: fc.integer({ min: SIMULATION_JUMP_MS - 1_000, max: 200_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 4_000_000, max: 7_000_000 }) },
);
/** How much wall time passes before a frame: one frame, a little more, a gap of about the pause threshold, a long gap. */
const arbWall = fc.oneof(
  { weight: 12, arbitrary: fc.constant(FRAME_MS) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: PAUSE_AFTER_WALL_MS - FRAME_MS }) },
  { weight: 2, arbitrary: fc.integer({ min: PAUSE_AFTER_WALL_MS - 50, max: PAUSE_AFTER_WALL_MS + 50 }) },
  { weight: 1, arbitrary: fc.integer({ min: PAUSE_AFTER_WALL_MS + 51, max: 20_000 }) },
);

/** One frame's change: session time and wall time advance, `gamePaused` maybe set or cleared, maybe a flashback report. */
type Change = { advanceMs: number; wallMs: number; gamePaused: 0 | 1 | undefined; report: 'none' | 'reported' | 'rewound' };

const arbChange = (reports: boolean): fc.Arbitrary<Change> =>
  fc.record({
    advanceMs: arbAdvance,
    wallMs: arbWall,
    gamePaused: fc.oneof({ weight: 6, arbitrary: fc.constant(undefined) }, { weight: 1, arbitrary: fc.constantFrom(0 as const, 1 as const) }),
    report: reports
      ? fc.oneof({ weight: 20, arbitrary: fc.constant('none' as const) }, { weight: 1, arbitrary: fc.constantFrom('reported' as const, 'rewound' as const) })
      : fc.constant('none' as const),
  });

/** A session: online or offline, a first frame, then up to 300 changes. */
const arbSession = (reports: boolean) =>
  fc.record({ networkGame: fc.boolean(), startMs: fc.integer({ min: 0, max: 100_000 }), changes: fc.array(arbChange(reports), { minLength: 1, maxLength: 300 }) });

type Session = { networkGame: boolean; startMs: number; changes: readonly Change[] };

/**
 * The frames of a session as the clock reads them: the first at `startMs`, each later one after its change (the session
 * time never below 0). A rewind's mark is the frame before's (its frame id, session time and receive time), as the
 * runner takes it from the state it leaves.
 */
const framesOf = ({ networkGame, startMs, changes }: Session): ClockFrame[] => {
  const frames: ClockFrame[] = [{ sessionMs: startMs, wallMs: 0, gamePaused: 0, networkGame }];
  changes.forEach((change, i) => {
    const before = frames[i]!;
    frames.push({
      sessionMs: Math.max(0, before.sessionMs + change.advanceMs),
      wallMs: before.wallMs + change.wallMs,
      gamePaused: change.gamePaused ?? before.gamePaused,
      networkGame,
      ...(change.report === 'reported' && { report: {} }),
      ...(change.report === 'rewound' && { report: { rewound: { frameId: i, rawMs: before.sessionMs, lastWallMs: before.wallMs } } }),
    });
  });
  return frames;
};

/** The clock's inputs for these frames. */
const inputsOf = (frames: readonly ClockFrame[]) => frames.reduce((b, f) => b.frame((g) => Object.assign(g, f)), clockInputs()).build();

/** Every problem of one session through the clock: per frame, at the session's end, and of the race clock. */
const problemsOf = (session: Session): string[] => {
  const inputs = inputsOf(framesOf(session));
  const problems: string[] = [];
  const spans: Span[] = [];
  let open = clockStepper.init();
  inputs.forEach((input, index) => {
    const before = clockStepper.openSpans(open);
    const lastRaceMs = open.lastRaceMs;
    const step = clockStepper.step(open, input);
    open = step.open;
    problems.push(...frameProblems(clockStepper, before, clockStepper.openSpans(open), step.closed).map((p) => `frame ${index}: ${p}`));
    spans.push(...(step.closed as Span[]));
    if (lastRaceMs !== undefined && open.lastRaceMs! < lastRaceMs && input.report === undefined) {
      problems.push(`frame ${index}: the race clock fell from ${lastRaceMs} to ${open.lastRaceMs} with no flashback report`);
    }
  });
  const end = open.lastRaceMs!;
  spans.push(...STEP0_CLOCK.openSpans(open.clock).map((s) => ({ ...s, end, endFrame: inputs.length + 1 })));
  problems.push(...spanListProblems(clockStepper, spans));
  return problems;
};

describe('the clock (C85)', () => {
  it('random clock sequences never give an undeclared transition, a throw, two open paused spans or overlapping spans, and the race clock never falls', () => {
    fc.assert(
      fc.property(arbSession(false), (session) => {
        expect(problemsOf(session)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
  it('with flashback reports, the race clock falls only on a reported frame, and no frame gives an undeclared transition, a throw or two open paused spans', () => {
    fc.assert(
      fc.property(arbSession(true), (session) => {
        // A rewind restores the race clock to its target, so in time (not in frames) a span may lie before an earlier one.
        expect(problemsOf(session).filter((p) => !p.includes(': overlap in ') && !/ends before it starts$/.test(p))).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
