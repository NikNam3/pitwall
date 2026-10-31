// The situation tracker (spec docs/superpowers/specs/2026-10-30-situations-design.md 2, 3): the first history step.
// It is the only module that reads the game's situation signals (SCAR, STLG, LGOT, RDFL, RCWN, CHQF, SEND, the safety
// car status, the session clock's jumps and pauses) to decide the session phase; the others read its spans.
import type { Frame } from '../../frame/frame.ts';
import type { EngineState } from '../../state/engine-state.ts';
import type { FlashbackReport, StepOutput, SubStep } from '../../step/types.ts';
import { applyPhaseSignals, enterPostSession, joinSession } from './session-phase.ts';
import { atRewindTarget, noteRewind, onRaceClock, restampStart, timeJumpOf, trackPauses } from './time-jumps.ts';

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
 * the race clock, the time every step stamps with. The runner's `report` comes first: a frame it took as a flashback
 * report is no jump, and the one it rewound on notes the rewind. A frame still on the pre-rewind session time is no
 * jump either and is stamped at the rewind's target. The start's settling re-stamps the start (`rewritten`); the
 * post-session simulation opens `postSession`; any other fall is reported as `clockFall` and, from the race start on,
 * the race clock continues over it by the fall's size (user ruling 2026-10-30); any other forward jump is reported as
 * `clockJump`.
 */
export const applySessionClock = (state: EngineState, frame: Frame, out: StepOutput, report: FlashbackReport | undefined): Frame => {
  const book = state.open.phaseBook;
  if (report?.rewound) noteRewind(state, report.rewound, frame);
  const stale = atRewindTarget(state, frame);
  if (stale) return stale;
  const onClock = (): Frame => (book.clockOffsetMs === 0 ? frame : { ...frame, sessionTime: onRaceClock(state, frame.sessionTime) });
  const clocked = onClock();
  // No frame before it (the session's first) or a flashback report: no jump to read.
  const { lastWallMs } = book;
  if (lastWallMs === undefined || report) return clocked;
  const jump = timeJumpOf(state, clocked, frame.receivedAtMs - lastWallMs);
  if (jump.kind === 'simulated') tagPhases(state, out, () => enterPostSession(state, state.sessionTime, out));
  else if (jump.kind === 'forward') out.clockJump = jump.jump;
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
 * formation lap, and `discarded` when a neutralisation is dropped unconfirmed or any phase opens or closes at a moment
 * an earlier frame was stamped at (a shared moment: a standing clock such as the grid's, the stale frames after a
 * rewind).
 */
export const applySituations: SubStep = (state, frame, out) => {
  trackPauses(state, frame);
  tagPhases(state, out, () => {
    const { phaseBook } = state.open;
    if (!phaseBook.started) joinSession(state, frame);
    applyPhaseSignals(state, frame, out);
    phaseBook.started = true;
  });
};
