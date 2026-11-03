// The warnings sub-machine's transition table (contract C15, C17, C18, C85). A car holds `noWarning` until the first
// warning and then one `warned` span per count (detail `{ count, infringement }`): the declared transitions are
//   none -> noWarning    the session's first frame, a car with no warning yet (join)
//   none -> warned       the session's first frame, a car that already holds warnings (join; its count, an
//                        infringement the machine has not seen)
//   noWarning -> warned  the first warning
//   warned -> warned     every further warning: the span closes and the next count opens
// A fall of `totalWarnings` is declared nowhere (the game never lowers it, inventory §2.6): no transition.
// Signal orders the recordings show (inventory §2.6, scan of every recording, 2026-11-03): the PENA of type 5 arrives on
// the frame `totalWarnings` rises or up to 16 frames before it, never after; so the PENA waits in the machine's open
// state (C18) and the rise opens the span, with the infringement of the PENA it takes.
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/warnings/machine.ts';
import { all, car, events, pena } from '../../support/car-edits.ts';
import { defineTransitionTable, inputs, type TransitionRow } from '../../support/transition-table.ts';

/** Car 0 holds `total` warnings from this frame on. */
export const total = (n: number) => car(0, { totalWarnings: n });
/** The PENA warning (type 5) of car 0. */
export const warning = (infringement: number) => events(pena(0, 5, infringement));

const rows: TransitionRow<MachineInput>[] = [
  { name: 'the session’s first frame, no warning: noWarning (join)', from: 'none', to: 'noWarning', input: inputs().frame(), join: true },
  { name: 'the session’s first frame, warnings already held: warned (join)', from: 'none', to: 'warned', input: inputs().frame(total(3)), join: true },
  {
    name: 'the PENA and the rise of totalWarnings on one frame: noWarning -> warned',
    from: 'noWarning',
    to: 'warned',
    input: inputs().frames(3).frame(all(warning(7), total(1))),
  },
  {
    name: 'the PENA 16 frames before the rise (the longest the recordings show): noWarning -> warned',
    from: 'noWarning',
    to: 'warned',
    input: inputs().frames(3).frame(warning(10)).frames(15).frame(total(1)),
  },
  {
    name: 'the rise with no PENA: noWarning -> warned',
    from: 'noWarning',
    to: 'warned',
    input: inputs().frames(3).frame(total(1)),
  },
  {
    name: 'a further warning: warned -> warned',
    from: 'warned',
    to: 'warned',
    input: inputs().frames(2).frame(all(warning(7), total(1))).frames(4).frame(all(warning(27), total(2))),
  },
  {
    name: 'a further warning, joined holding warnings: warned -> warned',
    from: 'warned',
    to: 'warned',
    input: inputs().frame(total(3)).frames(4).frame(all(warning(27), total(4))),
  },
];

export default defineTransitionTable(machine, rows);
