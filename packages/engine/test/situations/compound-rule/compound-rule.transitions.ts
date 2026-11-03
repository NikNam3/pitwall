// The compound-rule sub-machine's transition table (contract C9, C14, C15, C17, C18, C85): per car, race only. A car holds
// `required` (it must still run two dry compounds) until the race's first lap on intermediates or wets, which waives the
// rule (`waived`, C17); a waived rule stays waived (a later stop to a dry compound does not bring it back). Whether a car
// met the rule by running two dry compounds is a judgement of an analysis, not of this machine. Every car slot has a span
// from the first frame on; the first frame's span is a join (`joinedAt`: nothing tells whether the race is under way, as in
// car-flags). The declared transitions:
//   none -> required      the first frame, a car on a dry compound (join)
//   none -> waived        the first frame, a car on intermediates or wets (join): a wet start, or joined after the waiver
//   required -> waived    the car's visual compound becomes inter or wet
// Not declared: waived -> required, required -> required (a change between dry compounds changes nothing).
import type { VisualCompound } from '@pitwall/domain';
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/compound-rule/machine.ts';
import { all, inPhase, RACE } from '../session-phase/inputs.ts';
import { defineTransitionTable, inputs, type InputEdit, type TransitionRow } from '../../support/transition-table.ts';

/** Car `index` is on lap `lap` of the race on the visual compound `compound`, from this frame on. */
export const runs = (index: number, compound: VisualCompound, lap = 1): InputEdit => (i: MachineInput) => {
  const car = i.live.cars[index]!;
  car.tyres.visualCompound = compound;
  car.timing.lap = lap;
};
/** A race frame with car 0 on `compound`, lap `lap`. */
export const race = (compound: VisualCompound, lap = 1): InputEdit => all(inPhase(RACE), runs(0, compound, lap));

const rows: TransitionRow<MachineInput>[] = [
  { name: 'the first frame, a car on a dry compound: required (join)', from: 'none', to: 'required', input: inputs().frame(race('medium')), join: true },
  { name: 'the first frame, a car on intermediates: waived (join)', from: 'none', to: 'waived', input: inputs().frame(race('inter')), join: true },
  { name: 'the first frame, a car on wets: waived (join)', from: 'none', to: 'waived', input: inputs().frame(race('wet')), join: true },
  {
    name: 'the first lap on intermediates: required -> waived',
    from: 'required',
    to: 'waived',
    input: inputs().frames(3, race('medium', 2)).frame(race('inter', 3)),
  },
  {
    name: 'the first lap on wets: required -> waived',
    from: 'required',
    to: 'waived',
    input: inputs().frames(3, race('soft', 2)).frame(race('wet', 3)),
  },
];

export default defineTransitionTable(machine, rows);
