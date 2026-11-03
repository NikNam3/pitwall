// The car-flags transition table (contract C15, C17, C85): per car, the flag race control shows it (`vehicleFIAFlags`,
// signal `fiaFlag`). A car has a span from the session's first frame on, so `none -> <kind>` is the first frame (a join
// row: the span has `joinedAt`); after it every change of the car's flag closes its span and opens the next, `<kind> ->
// <other kind>`. The game's "none" is `noFlag`, its "invalid/unknown" `unknown` (C3). No kind goes to `none`.
import type { ZoneFlag } from '@pitwall/domain';
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/car-flags/machine.ts';
import { defineTransitionTable, inputs, type TransitionRow } from '../../support/transition-table.ts';

/** The span kinds, and the game flag each stands for. */
export const FLAG_OF = { noFlag: 'none', green: 'green', blue: 'blue', yellow: 'yellow', unknown: 'unknown' } as const satisfies Record<string, ZoneFlag>;
export type FlagKind = keyof typeof FLAG_OF;
export const KINDS = Object.keys(FLAG_OF) as FlagKind[];

/** Car `car` shows `flag` on this frame. */
export const shows = (car: number, kind: FlagKind) => (i: MachineInput): void => {
  i.signals.cars[car]!.fiaFlag = FLAG_OF[kind];
};

const rows: TransitionRow[] = [
  // The session's first frame: the car's span opens with whatever flag the frame shows.
  ...KINDS.map((kind): TransitionRow => ({ name: `joins a session in progress: the car shows ${kind}`, from: 'none', to: kind, input: inputs().frame(shows(0, kind)), join: true })),
  // Every change of the car's flag, `from` for two frames, then `to`.
  ...KINDS.flatMap((from) =>
    KINDS.filter((to) => to !== from).map(
      (to): TransitionRow => ({ name: `the flag changes from ${from} to ${to}`, from, to, input: inputs().frames(2, shows(0, from)).frame(shows(0, to)) }),
    ),
  ),
];

export default defineTransitionTable(machine, rows);
