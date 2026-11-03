// The transition rows shared by the qualifying and the practice session-phase sub-machines (contract C9, C14, C17, C36,
// C85), ported from the legacy tracker: the two declare the same kinds and transitions. `grid` while the session clock
// stands at the full duration, `running` once it runs, `suspended` on a red flag (§1.12, §4: not yet seen, C19),
// `finished` when SEND comes with every car in the session finished (time over, SgQ), `postSession` on SEND or the
// clock's simulated end (C36; ZvP, ZvP2, MiP). A session joined in progress (the time left below the duration) opens
// `running` with `joinedAt` (MiP starts at 121.6 s, Review Focus 2). The end of a session is a signal, never the final
// classification's arrival (user ruling, Task 9).
import type { WeekendPhase } from '@pitwall/domain';
import { inputs, type InputEdit, type TransitionRow } from '../../support/transition-table.ts';
import { all, clockRuns, events, heldAt, inPhase, RDFL, results, SEND, simulatedEnd } from './inputs.ts';

/** The rows of the qualifying (`QUALIFYING`) or the practice (`PRACTICE`) table. */
export const timedSessionRows = (phase: WeekendPhase): TransitionRow[] => {
  const frame = (...edits: InputEdit[]): InputEdit => all(inPhase(phase), ...edits);
  /** The session's first frame before the clock runs: the time left at the full duration, the clock held at 0. */
  const onGrid = () => inputs().frame(frame(heldAt(0)));
  /** Joined while the session clock runs. */
  const running = () => inputs().frame(frame(clockRuns));
  const suspended = () => running().frame(frame(clockRuns, events(RDFL)));
  /** Time over: SEND with every car finished, in the frame that sets them finished (SgQ 900.594 s). */
  const timeOver = frame(clockRuns, results('finished', 'finished'), events(SEND));
  return [
    { name: 'the first frame before the session clock runs opens grid', from: 'none', to: 'grid', input: onGrid() },
    { name: 'joins a session in progress: the time left below the duration (MiP, 121.6 s)', from: 'none', to: 'running', input: running(), join: true },
    { name: 'the session clock starts: grid closes and running opens', from: 'grid', to: 'running', input: onGrid().frame(frame(clockRuns)) },
    // A red flag in qualifying or practice: not yet seen in any recording, and no restart signal is known (inventory
    // §1.12, §4; C19). A suspension therefore has no restart transition: it ends only with finished or the post-session.
    { name: 'a red flag suspends the session', from: 'running', to: 'suspended', input: suspended() },
    { name: 'time over: SEND with every car finished closes running with finished (SgQ)', from: 'running', to: 'finished', input: running().frame(timeOver) },
    { name: 'time over under a red flag: SEND with every car finished closes the suspension with finished', from: 'suspended', to: 'finished', input: suspended().frame(timeOver) },
    { name: 'the finished span of time over opens and closes on the SEND frame: the post-session follows', from: 'finished', to: 'postSession', input: running().frame(timeOver) },
    { name: 'SEND before the session clock runs opens the post-session', from: 'grid', to: 'postSession', input: onGrid().frame(frame(heldAt(0), events(SEND))) },
    {
      name: 'left from the menu: SEND with the player retired and the others finished opens the post-session, no finish (MiP)',
      from: 'running',
      to: 'postSession',
      input: running().frame(frame(clockRuns, results('retired', 'finished'), events(SEND))),
    },
    { name: 'the clock’s simulated end opens the post-session (ZvP, ZvP2)', from: 'running', to: 'postSession', input: running().frame(frame(clockRuns, simulatedEnd)) },
    { name: 'SEND under a red flag with a car still running opens the post-session', from: 'suspended', to: 'postSession', input: suspended().frame(frame(clockRuns, events(SEND))) },
  ];
};
