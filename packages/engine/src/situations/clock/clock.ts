// Step 0, the clock (contract C7, C20, C35-C37): it reads the frame's session time, the runner's flashback report and
// the receive-time differences, and returns the frame on the race clock with its clock facts. Every fall that is no
// flashback is carried over by an offset, so the race clock never falls but at a flashback, and nothing recorded is
// re-timed (C36). The clock is no member of the step-2 registry (`MACHINES`): step 0 runs before every other step,
// and the sub-machines read its state as `MachineInput.clock` (`clockInput`), not as an upstream.
import { clockSpans, type ClockFact, type FrameNumber, type OpenSpan, type SessionTime } from '@pitwall/domain';
import type { Frame } from '../../frame/frame.ts';
import type { EngineState } from '../../state/engine-state.ts';
import type { FlashbackReport, RewindMark } from '../../step/types.ts';
import type { DeepReadonly } from '../../util/deep-readonly.ts';
import type { ClockInput } from '../machine.ts';
import { jumpOf } from './jumps.ts';
import { pauseSoFar, trackPause } from './pauses.ts';
import { CLOCK_MACHINE, type ClockOpen, type PausedSpan } from './types.ts';

/** What the clock reads of one frame besides its own open state. */
export type ClockStepInput = {
  frame: Frame;
  /** The runner's decision that the frame reports a flashback (no jump is read on it); `rewound` when it rewound on it. */
  report: FlashbackReport | undefined;
  /** The previous frame's time on the race clock. */
  lastRaceMs: SessionTime;
  /** An online session: the game's `gamePaused` pauses it, not a gap in the packets. */
  networkGame: boolean;
  /** The frame's number (C26): the clock facts describe it, and a paused span opens and closes on it. */
  frameNumber: FrameNumber;
};

/**
 * One step of the clock: its new open state, the frame on the race clock, the clock facts for `clock` (`fall`, `jump`,
 * `simulatedEnd`, each describing this frame) and the paused span it closed (for `spans:clock`, closed on this frame).
 */
export type ClockStep = { open: ClockOpen; frame: Frame; facts: ClockFact[]; closed: PausedSpan[] };

const onClock = (frame: Frame, offsetMs: number): Frame => (offsetMs === 0 ? frame : { ...frame, sessionTime: frame.sessionTime + offsetMs });

/**
 * Notes the rewind the runner took on `frame`, before the frame is applied, on its first pass and on every replay of
 * it: wall time does not go back, so an offline pause is measured from the last frame applied before the rewind
 * (`before.lastWallMs`), not the restored one. The old timeline's last session time is the new frame's own when its
 * frame id still rises (an FLBK sent on the old timeline), else the time where the rewind started. While frames carry
 * exactly that time (inventory 1.10: the game's time, whatever the race clock did), they belong to the rewind's target
 * moment (`staleRawMs`).
 */
const noteRewind = (open: ClockOpen, before: RewindMark, frame: Frame): void => {
  open.lastWallMs = before.lastWallMs;
  const oldMs = frame.frameId > before.frameId ? frame.sessionTime : before.rawMs;
  open.staleRawMs = frame.sessionTime === oldMs ? oldMs : undefined;
};

/**
 * The frame timed at the rewind's target moment (the previous frame's time on the race clock) while it still carries
 * the pre-rewind session time (supervisor ruling 2026-10-31): what it records belongs there, and it is no jump. The
 * mark ends at the first frame on another time; undefined from then on.
 */
const atRewindTarget = (open: ClockOpen, frame: Frame, lastRaceMs: SessionTime): Frame | undefined => {
  if (open.staleRawMs === undefined) return undefined;
  if (frame.sessionTime === open.staleRawMs) return { ...frame, sessionTime: lastRaceMs };
  open.staleRawMs = undefined;
  return undefined;
};

/**
 * The frame on the race clock and the jump facts of the session time to it. No frame before it (the session's first),
 * a flashback report and the simulated end read no jump; a frame still on the pre-rewind session time is timed at the
 * rewind's target. The simulation of the rest of the session appends `simulatedEnd` (the session-phase signal, C36),
 * any other forward jump of more than a minute a `jump`, and every fall a `fall` whose size the race clock continues over.
 */
const clockFrame = (open: ClockOpen, input: ClockStepInput, facts: ClockFact[]): Frame => {
  const { frame, report, lastRaceMs, frameNumber } = input;
  const stale = atRewindTarget(open, frame, lastRaceMs);
  if (stale) return stale;
  const clocked = onClock(frame, open.offsetMs);
  if (open.lastWallMs === undefined || report || open.ended) return clocked;
  const jump = jumpOf(lastRaceMs, clocked.sessionTime, frame.receivedAtMs - open.lastWallMs);
  const fromMs = lastRaceMs - open.offsetMs;
  if (jump.kind === 'simulated') {
    facts.push({ kind: 'simulatedEnd', at: lastRaceMs, frame: frameNumber });
    open.ended = true;
  } else if (jump.kind === 'forward') facts.push({ kind: 'jump', at: lastRaceMs, fromMs, toMs: frame.sessionTime, frame: frameNumber });
  else if (jump.kind === 'fall') {
    facts.push({ kind: 'fall', at: lastRaceMs, fromMs, toMs: frame.sessionTime, offsetMs: jump.offsetMs, frame: frameNumber });
    open.offsetMs += jump.offsetMs;
    return onClock(frame, open.offsetMs);
  }
  return clocked;
};

/** The clock: step 0 (C7); its span declaration in domain (C15): session scope, its one span kind `paused`. */
export const STEP0_CLOCK = {
  id: CLOCK_MACHINE,
  spans: clockSpans,
  init: (): ClockOpen => ({ offsetMs: 0, opened: 0, ended: false }),
  /** The pause in progress, its wall time so far: `view.situation.byMachine.clock` (C20). */
  openSpans: (open: DeepReadonly<ClockOpen>): OpenSpan[] =>
    open.pause ? [pauseSoFar(open.pause as NonNullable<ClockOpen['pause']>, open.lastWallMs ?? open.pause.sinceWallMs)] : [],
  step(previous: DeepReadonly<ClockOpen>, input: ClockStepInput): ClockStep {
    const open: ClockOpen = { ...(previous as ClockOpen) };
    const { frame, report } = input;
    if (report?.rewound) noteRewind(open, report.rewound, frame);
    const facts: ClockFact[] = [];
    const clocked = clockFrame(open, input, facts);
    const pause = trackPause(open, {
      networkGame: input.networkGame,
      gamePaused: frame.session?.gamePaused,
      wallMs: frame.receivedAtMs,
      fromMs: input.lastRaceMs,
      atMs: clocked.sessionTime,
      frameNumber: input.frameNumber,
    });
    open.lastWallMs = frame.receivedAtMs;
    return { open, frame: clocked, facts, closed: pause ? [pause] : [] };
  },
} as const;

/** A session time of the game on the race clock of `state`. */
export const onRaceClock = (state: DeepReadonly<EngineState>, sessionTime: SessionTime): SessionTime => sessionTime + state.open.clock.offsetMs;

/** Step 0's clock as the sub-machines read it (`MachineInput.clock`): a pause in progress and the race clock's offset. */
export const clockInput = (state: DeepReadonly<EngineState>): ClockInput => ({
  paused: state.open.clock.pause !== undefined,
  offsetMs: state.open.clock.offsetMs,
});

/** The mark of `state`, taken by the runner before it restores a snapshot (after the session's first frame). */
export const rewindMarkOf = (state: DeepReadonly<EngineState>): RewindMark => ({
  frameId: state.lastFrameId,
  rawMs: state.sessionTime - state.open.clock.offsetMs,
  lastWallMs: state.open.clock.lastWallMs,
});
