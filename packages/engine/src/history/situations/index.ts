// The situation tracker (spec docs/superpowers/specs/2026-10-30-situations-design.md 2, 3): the first history step.
// It is the only module that reads the game's situation signals (SCAR, STLG, LGOT, RDFL, RCWN, CHQF, SEND, the safety
// car status, the session clock's jumps and pauses) to decide the session phase; the others read its spans.
import type { SubStep } from '../../step/types.ts';
import { applyPhaseSignals, enterPostSession, joinSession } from './session-phase.ts';
import { restampStart, timeJumpOf, trackPauses } from './time-jumps.ts';

/**
 * Records the session phases (`history.sessionPhases`, the open one in `open.situations`) and the pauses. Tags
 * `sessionPhases` when a phase opened, closed or changed. Reports a fall of the session time that is no start settling
 * as `clockFall`, and marks the step `rewritten` when lights out discards the formation lap or the start settles.
 */
export const applySituations: SubStep = (state, frame, out) => {
  const { history, open } = state;
  const phasesBefore = history.sessionPhases.length;
  const openBefore = open.situations.session;
  trackPauses(state, frame);
  if (!open.phaseBook.started) {
    joinSession(state, frame);
    open.phaseBook.started = true;
  } else {
    const jump = timeJumpOf(state, frame);
    if (jump.kind === 'simulated') enterPostSession(state, state.sessionTime);
    else if (jump.kind === 'fall') out.clockFall = jump.fall;
    else if (jump.kind === 'settle') {
      restampStart(state, jump.offsetMs);
      out.rewritten = true;
    }
  }
  applyPhaseSignals(state, frame, out);
  if (history.sessionPhases.length !== phasesBefore || open.situations.session !== openBefore) out.changed.add('sessionPhases');
};
