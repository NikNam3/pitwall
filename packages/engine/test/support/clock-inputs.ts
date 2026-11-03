// Step 0's clock as a table and a property drive it (contract C7, C15, C85): the clock is a sub-machine outside the
// registry, stepped with `ClockStepInput`s, not `MachineInput`s. `clockInputs()` builds its frames as the clock reads
// them (the game's session time, the receive time, `gamePaused`, an online session, the runner's flashback report);
// `clockStepper` is `STEP0_CLOCK` as a `Steppable`, which threads the previous frame's race-clock time
// (`ClockStepInput.lastRaceMs`) as step 0 does (`state.sessionTime`, the race clock after the step before).
import type { SessionTime } from '@pitwall/domain';
import type { Frame } from '../../src/index.ts';
import { STEP0_CLOCK, type ClockStepInput } from '../../src/situations/clock/clock.ts';
import type { ClockOpen } from '../../src/situations/clock/types.ts';
import type { FlashbackReport } from '../../src/step/types.ts';
import type { DeepReadonly } from '../../src/util/deep-readonly.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { FRAME_MS, type InputBuilder, type Steppable } from './transition-table.ts';

/** One frame as the clock reads it. */
export type ClockFrame = {
  /** The game's session time (ms). */
  sessionMs: SessionTime;
  /** The frame's receive time (wall clock, ms). */
  wallMs: number;
  /** The Session packet's `gamePaused`; undefined: the frame carries no Session packet. */
  gamePaused: 0 | 1 | undefined;
  /** An online session: the game's `gamePaused` pauses it, not a gap in the packets. */
  networkGame: boolean;
  /** The runner took the frame as a flashback report (`{}`), or rewound on it (`{ rewound }`). */
  report?: FlashbackReport | undefined;
};

/** One frame's input to `clockStepper`: everything the clock reads but the race clock before it. */
export type ClockFrameInput = Omit<ClockStepInput, 'lastRaceMs'>;

/** Edits one frame in place. */
export type ClockEdit = (frame: ClockFrame, index: number) => void;

const baseFrame = (() => {
  let base: Frame | undefined;
  return (): Frame => (base ??= new ScenarioBuilder({ cars: 2 }).frames(1, () => {}).build()[0]!);
})();

/** The input of one built frame: frame id `index`, frame number `index + 1` (C26). */
const inputOf = (f: ClockFrame, index: number): ClockFrameInput => {
  const base = baseFrame();
  const frame: Frame = { ...base, frameId: index, overallFrameId: index, sessionTime: f.sessionMs, receivedAtMs: f.wallMs, events: [] };
  if (f.gamePaused === undefined) Reflect.deleteProperty(frame, 'session');
  else frame.session = { ...base.session!, gamePaused: f.gamePaused };
  return { frame, report: f.report, networkGame: f.networkGame, frameNumber: index + 1 };
};

/**
 * The frames the clock steps through, one per frame. The first is an offline session at session time 0 and receive
 * time 0 with `gamePaused` 0; each later frame starts `FRAME_MS` of session and wall time after the previous one, with
 * its `gamePaused` and `networkGame` and no report, and is then edited.
 */
export class ClockInputBuilder implements InputBuilder<ClockFrameInput> {
  readonly #edits: ClockEdit[] = [];

  /** One frame, edited by `edit`. */
  frame(edit: ClockEdit = () => {}): this {
    this.#edits.push(edit);
    return this;
  }

  /** `n` frames, each edited by `edit`. */
  frames(n: number, edit: ClockEdit = () => {}): this {
    for (let k = 0; k < n; k++) this.#edits.push(edit);
    return this;
  }

  /** The frames as the clock reads them, before they become inputs. */
  clockFrames(): ClockFrame[] {
    const built: ClockFrame[] = [];
    let previous: ClockFrame | undefined;
    this.#edits.forEach((edit, index) => {
      const f: ClockFrame = previous
        ? { sessionMs: previous.sessionMs + FRAME_MS, wallMs: previous.wallMs + FRAME_MS, gamePaused: previous.gamePaused, networkGame: previous.networkGame }
        : { sessionMs: 0, wallMs: 0, gamePaused: 0, networkGame: false };
      edit(f, index);
      built.push(f);
      previous = f;
    });
    return built;
  }

  build(): ClockFrameInput[] {
    return this.clockFrames().map(inputOf);
  }
}

/** A new, empty `ClockInputBuilder`. */
export const clockInputs = (): ClockInputBuilder => new ClockInputBuilder();

/**
 * The clock's open state as `clockStepper` keeps it: the clock's own and the race clock after the last frame; undefined
 * before the session's first frame.
 */
export type ClockDriven = { clock: DeepReadonly<ClockOpen>; lastRaceMs: SessionTime | undefined };

/**
 * `STEP0_CLOCK` as a table and a property drive it: its id, span declaration and declared transitions, and its step
 * with the race clock of the frame before; on the session's first frame the frame's own session time, as a new state
 * starts at its first packet's (`initialState`).
 */
export const clockStepper: Steppable<ClockDriven, ClockFrameInput> = {
  id: STEP0_CLOCK.id,
  spans: STEP0_CLOCK.spans,
  transitions: STEP0_CLOCK.transitions,
  init: () => ({ clock: STEP0_CLOCK.init(), lastRaceMs: undefined }),
  openSpans: (driven) => STEP0_CLOCK.openSpans(driven.clock),
  step(driven, input) {
    const step = STEP0_CLOCK.step(driven.clock, { ...input, lastRaceMs: driven.lastRaceMs ?? input.frame.sessionTime });
    return { open: { clock: step.open, lastRaceMs: step.frame.sessionTime }, closed: step.closed };
  },
};
