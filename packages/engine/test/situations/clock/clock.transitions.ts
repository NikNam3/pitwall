// The clock's transition table (contract C7, C15, C85): step 0's clock is a sub-machine outside the registry whose spans
// tile the session (user ruling 2026-11-03): `running` while the session runs, `paused` while it is paused. The session's
// first frame opens `running`, or `paused` when it is already an online pause; a span the first frame opens carries
// `joinedAt` (supervisor ruling, Task M1-R). Online, `gamePaused` 1 closes `running` and opens `paused`, `gamePaused` 0
// closes `paused` and opens `running`, both on the frame the signal changes. Offline, a gap of more than 2 s of wall time
// beyond what the session time advanced is a paused span that opens and closes on the frame after the gap (C26: it
// covers no frame), between the `running` span that closes there and the one that opens there.
import { clockInputs, clockStepper, type ClockFrame } from '../../support/clock-inputs.ts';
import { defineTransitionTable } from '../../support/transition-table.ts';

const online = (f: ClockFrame): void => {
  f.networkGame = true;
};
const paused = (f: ClockFrame): void => {
  f.gamePaused = 1;
};
const resumed = (f: ClockFrame): void => {
  f.gamePaused = 0;
};
/** No frame for 3 s of wall time before this one, while the session time advanced one frame. */
const afterGap = (f: ClockFrame): void => {
  f.wallMs += 3_000;
};

export default defineTransitionTable(clockStepper, [
  { name: 'the session’s first frame opens running', from: 'none', to: 'running', input: clockInputs().frame(), join: true },
  {
    name: 'online: the session’s first frame, already paused by the game, opens paused',
    from: 'none',
    to: 'paused',
    input: clockInputs().frame((f) => {
      online(f);
      paused(f);
    }),
    join: true,
  },
  { name: 'online: gamePaused 1 closes running and opens paused', from: 'running', to: 'paused', input: clockInputs().frame(online).frame(paused) },
  { name: 'offline: a gap of more than 2 s closes running and opens a paused span on the frame after it', from: 'running', to: 'paused', input: clockInputs().frame().frame(afterGap) },
  { name: 'online: gamePaused 0 closes paused and opens running', from: 'paused', to: 'running', input: clockInputs().frame(online).frame(paused).frame(resumed) },
  { name: 'offline: the paused span of a gap closes on the frame it opened on, and running opens there', from: 'paused', to: 'running', input: clockInputs().frame().frame(afterGap) },
]);
