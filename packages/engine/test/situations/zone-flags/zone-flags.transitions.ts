// The zone-flags transition table (contract C15, C17, C85): per marshal zone, its flag (signal `marshalZones`). A zone is
// a scope from the first frame the Session packet lists it: when that is the session's first frame the span has
// `joinedAt` (join rows); when the list grows later it has none (the `none -> <kind>` rows). After it every change of
// the zone's flag closes its span and opens the next. The game's "none" is `noFlag`, its "invalid/unknown" `unknown`
// (C3). No kind goes to `none`.
import type { Ratio } from '@pitwall/domain';
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/zone-flags/machine.ts';
import { defineTransitionTable, inputs, type TransitionRow } from '../../support/transition-table.ts';
import { FLAG_OF, KINDS, type FlagKind } from '../car-flags/car-flags.transitions.ts';

/** Where zone `zone` of `count` starts on the lap, as the Session packet lists them: evenly. */
export const startOf = (zone: number, count: number): Ratio => zone / count;

/** The Session packet lists `kinds.length` zones, zone `i` with the flag `kinds[i]` (an empty list: no zone yet). */
export const lists = (...kinds: FlagKind[]) => (i: MachineInput): void => {
  i.signals.session.marshalZones = kinds.map((kind, zone) => ({ startFraction: startOf(zone, kinds.length), flag: FLAG_OF[kind] }));
};

const rows: TransitionRow[] = [
  // The session's first frame already lists the zone.
  ...KINDS.map((kind): TransitionRow => ({ name: `joins a session in progress: the zone shows ${kind}`, from: 'none', to: kind, input: inputs().frame(lists(kind)), join: true })),
  // The first frames list no zone (the game's defaults before the real Session packet); a later frame lists it.
  ...KINDS.map((kind): TransitionRow => ({ name: `the zone is listed on a later frame, showing ${kind}`, from: 'none', to: kind, input: inputs().frames(3, lists()).frame(lists(kind)) })),
  // Not yet seen (C19): no recording lists fewer zones later in a session. A zone a later Session packet no longer lists
  // has an unknown flag from that frame on (C3: missing data, not a kept value): its span closes, `unknown` opens for it.
  { name: 'not yet seen: a zone no longer listed turns unknown', from: 'yellow', to: 'unknown', input: inputs().frames(2, lists('green', 'yellow')).frame(lists('green')) },
  { name: 'not yet seen: a zone listed again after being dropped shows its flag', from: 'unknown', to: 'blue', input: inputs().frame(lists('green', 'yellow')).frame(lists('green')).frame(lists('green', 'blue')) },
  ...KINDS.flatMap((from) =>
    KINDS.filter((to) => to !== from).map(
      (to): TransitionRow => ({ name: `the flag changes from ${from} to ${to}`, from, to, input: inputs().frames(2, lists(from)).frame(lists(to)) }),
    ),
  ),
];

export default defineTransitionTable(machine, rows);
