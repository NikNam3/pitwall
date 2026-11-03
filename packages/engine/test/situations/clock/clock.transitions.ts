// The clock's transition table (contract C7, C15, C85): step 0's clock is a sub-machine outside the registry, with one
// span kind, `paused`, and no span while the session runs (`none`). Online, `gamePaused` 1 opens a paused span and
// `gamePaused` 0 closes it; offline, a gap of more than 2 s of wall time beyond what the session time advanced opens and
// closes one on the frame after the gap (C26: a span may open and close on the same frame). No join row: a session
// joined while paused is no case the clock can see.
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
  { name: 'online: gamePaused 1 opens a paused span', from: 'none', to: 'paused', input: clockInputs().frame(online).frame(paused) },
  { name: 'offline: a gap of more than 2 s opens a paused span on the frame after it', from: 'none', to: 'paused', input: clockInputs().frame().frame(afterGap) },
  { name: 'online: gamePaused 0 closes the paused span', from: 'paused', to: 'none', input: clockInputs().frame(online).frame(paused).frame(resumed) },
  { name: 'offline: the paused span of a gap closes on the frame it opened on', from: 'paused', to: 'none', input: clockInputs().frame().frame(afterGap) },
]);
