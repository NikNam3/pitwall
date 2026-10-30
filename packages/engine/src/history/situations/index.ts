// The situation tracker (spec docs/superpowers/specs/2026-10-30-situations-design.md 2, 3): the first history step.
// It is the only module that reads the game's situation signals (SCAR, STLG, LGOT, RDFL, RCWN, CHQF, SEND, the safety
// car status, the session clock's jumps and pauses) to decide the session phase; the others read its spans.
import type { Frame } from '../../frame/frame.ts';
import type { EngineState } from '../../state/engine-state.ts';
import type { StepOutput, SubStep } from '../../step/types.ts';
import { applyPhaseSignals, enterPostSession, joinSession } from './session-phase.ts';
import { followsRewind, onRaceClock, restampStart, timeJumpOf, trackPauses } from './time-jumps.ts';

/** Runs `apply` and tags `sessionPhases` when it opened, closed or changed a phase. */
const tagPhases = (state: EngineState, out: StepOutput, apply: () => void): void => {
  const { history, open } = state;
  const phasesBefore = history.sessionPhases.length;
  const openBefore = open.situations.session;
  apply();
  if (history.sessionPhases.length !== phasesBefore || open.situations.session !== openBefore) out.changed.add('sessionPhases');
};

/**
 * Reads the jump of the session time to `frame` (spec 3.3) before any step stamps with it, and returns the frame on
 * the race clock, the time every step stamps with. A frame the runner took as a flashback report, or one still on the
 * flashback's old time, is no jump. The start's settling re-stamps the start (`rewritten`); the post-session
 * simulation opens `postSession`; any other fall is reported as `clockFall` and, from the race start on, the race clock
 * continues over it by the fall's size (user ruling 2026-10-30).
 */
export const applySessionClock = (state: EngineState, frame: Frame, out: StepOutput): Frame => {
  const book = state.open.phaseBook;
  const onClock = (): Frame => (book.clockOffsetMs === 0 ? frame : { ...frame, sessionTime: onRaceClock(state, frame.sessionTime) });
  const clocked = onClock();
  if (!book.started || followsRewind(state, clocked) || frame.flashbackReport) return clocked;
  const jump = timeJumpOf(state, clocked);
  if (jump.kind === 'simulated') tagPhases(state, out, () => enterPostSession(state, state.sessionTime, out));
  else if (jump.kind === 'settle') {
    restampStart(state, jump.offsetMs);
    out.rewritten = true;
  } else if (jump.kind === 'fall') {
    out.clockFall = jump.fall;
    book.clockOffsetMs += jump.offsetMs;
    return onClock();
  }
  return clocked;
};

/**
 * Records the session phases (`history.sessionPhases`, the open one in `open.situations`) and the pauses. Tags
 * `sessionPhases` when a phase opened, closed or changed; marks the step `rewritten` when lights out discards the
 * formation lap, and `discarded` when a neutralisation is dropped unconfirmed.
 */
export const applySituations: SubStep = (state, frame, out) => {
  trackPauses(state, frame);
  tagPhases(state, out, () => {
    if (!state.open.phaseBook.started) {
      joinSession(state, frame);
      state.open.phaseBook.started = true;
    }
    applyPhaseSignals(state, frame, out);
  });
};
