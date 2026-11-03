// The session phases of a practice or qualifying session (contract C9, C14, C17, C36), shared by their two sub-machines,
// which declare the same kinds and transitions: `grid` while the session clock stands, `running` once it runs,
// `suspended` on a red flag (not yet seen, inventory §1.12, §4; C19: no restart signal is known, so a suspension ends
// only with finished or the post-session), `finished` when SEND comes with every car in the session finished (time
// over, SgQ), `postSession` on SEND or the clock's simulated end (ZvP, ZvP2, MiP). A session joined in progress (the
// time left below the duration, MiP at 121.6 s) opens `running` with `joinedAt`. The session's end is a signal, never
// the final classification's arrival (user ruling, Task 9).
import { unknown, type SpanDeclaration, type WeekendPhaseKind } from '@pitwall/domain';
import { CAR_STATUS } from '../car-status/in-session.ts';
import type { SubMachine } from '../machine.ts';
import { draftOf, enter, eventsOf, everyCarFinished, initialPhaseOpen, isPostSession, kindOf, simulatedEnd, stepOf, type PhaseDraft, type PhaseOpen } from './phases.ts';

/** The session's first frame the machine runs: `running` (joined) when the session clock already ran, else `grid`. */
const join = (d: PhaseDraft): void => {
  const { timeLeftMs, durationMs } = d.input.live.session;
  if (timeLeftMs < durationMs) enter(d, 'running', d.input.at, { joined: true });
  else enter(d, 'grid', d.input.at);
};

/** SEND ends the session: time over (every car finished) closes running or the suspension with finished first. */
const endSession = (d: PhaseDraft): void => {
  if (isPostSession(d)) return;
  const kind = kindOf(d);
  if ((kind === 'running' || kind === 'suspended') && everyCarFinished(d.input)) enter(d, 'finished', d.input.at);
  enter(d, 'postSession', d.input.at);
};

/** A practice or qualifying session-phase sub-machine: its span declaration (its id, C15) and its weekend phase. */
export const timedSessionMachine = (spans: SpanDeclaration, phase: WeekendPhaseKind): SubMachine<PhaseOpen> => ({
  id: spans.machine,
  appliesTo: [phase],
  spans,
  inputs: { signals: ['events', 'resultStatus'], values: ['session'], upstream: ['weekend-phase', CAR_STATUS] },
  transitions: [
    ['none', 'grid'],
    ['none', 'running'],
    ['grid', 'running'],
    ['running', 'suspended'],
    ['running', 'finished'],
    ['suspended', 'finished'],
    ['finished', 'postSession'],
    ['grid', 'postSession'],
    ['running', 'postSession'],
    ['suspended', 'postSession'],
  ],
  init: initialPhaseOpen,
  openSpans: (open) => (open.span ? [open.span] : []),
  step(previous, input) {
    const d = draftOf(spans.machine, previous, input);
    const { at } = input;
    if (d.open.span === undefined) join(d);
    simulatedEnd(d);
    for (const event of eventsOf(input)) {
      if (event.code === 'RDFL' && kindOf(d) === 'running') enter(d, 'suspended', at, { detail: { restart: unknown('notReceived') } });
      else if (event.code === 'SEND') endSession(d);
    }
    // The session clock starts: the time moved on from the previous frame's.
    if (kindOf(d) === 'grid' && d.open.lastAt !== undefined && at > d.open.lastAt) enter(d, 'running', at);
    return stepOf(d);
  },
});
