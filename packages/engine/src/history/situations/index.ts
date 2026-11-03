// The situation tracker (spec docs/history/specs/2026-10-30-situations-design.md 2, 3): the first history step.
// It is the only module that reads the game's situation signals (SCAR, STLG, LGOT, RDFL, RCWN, CHQF, SEND, the safety
// car status) to decide the session phase; the others read its spans. The session clock is step 0's
// (`situations/clock/`): the tracker reads the frame on the race clock and the clock's simulated end.
import type { Frame } from '../../frame/frame.ts';
import type { EngineState } from '../../state/engine-state.ts';
import type { StepOutput } from '../../step/types.ts';
import { applyPhaseSignals, enterPostSession, joinSession } from './session-phase.ts';

/** Runs `apply` and tags `sessionPhases` when it opened, closed or changed a phase. */
const tagPhases = (state: EngineState, out: StepOutput, apply: () => void): void => {
  const { log, open } = state;
  const phasesBefore = log.sessionPhases.length;
  const openBefore = open.situations.session;
  apply();
  if (log.sessionPhases.length !== phasesBefore || open.situations.session !== openBefore) out.changed.add('sessionPhases');
};

/**
 * The clock read the simulated end of the session (a `simulatedEnd` fact, the session-phase signal of C36): the
 * post-session opens at the previous frame's time, before the frame's state update.
 */
export const applySimulatedEnd = (state: EngineState, out: StepOutput): void => {
  tagPhases(state, out, () => enterPostSession(state, state.sessionTime, out));
};

/**
 * Records the session phases (`history.sessionPhases`, the open one in `open.situations`). Tags `sessionPhases` when a
 * phase opened, closed or changed; marks the step `rewritten` when lights out discards the formation lap, and
 * `discarded` when a neutralisation is dropped unconfirmed or a phase opens or closes at or before the time of an entry
 * an earlier frame recorded (a moment frames share: a standing clock such as the grid's, the stale frames after a
 * rewind).
 */
export const applySituations = (state: EngineState, frame: Frame, out: StepOutput): void => {
  tagPhases(state, out, () => {
    const { phaseBook } = state.open;
    if (!phaseBook.started) joinSession(state, frame);
    applyPhaseSignals(state, frame, out);
    phaseBook.started = true;
  });
};
