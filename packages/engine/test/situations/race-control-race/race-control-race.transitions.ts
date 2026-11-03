// The race's race-control sub-machine's transition table (contract C9, C12, C14, C15, C17, C18, C85): session-scoped, DRS
// in a race and sprint. Span kinds: `drsOff` (detail `{ reason }`: `notEnabledYet`, or the reason of the DRSD that
// switched it off: `wetTrack`, `safetyCar`, `redFlag`, `minLapNotReached`, and `unknown` for a code the spec does not
// list, C3) and `drsOn`. The declared transitions are
//   none -> drsOff     the session's first frame before the lights out: `notEnabledYet` (on the grid: the session's
//                      start; in the formation lap or at the start lights: a join, `joinedAt`)
//   none -> drsOn      the session's first frame after the lights out, a race joined in progress (join): DRS counts as
//                      on until a DRSD (the rule of the old `drsStatus`, battle's DRS test of w2/drs 479ec09)
//   drsOff -> drsOn    DRSE after the lights out
//   drsOn -> drsOff    DRSD after the lights out, with its reason
//   drsOff -> drsOff   a DRSD after the lights out while DRS is off with another reason (`notEnabledYet` included)
// Signal orders (inventory §1.4 and §4): DRSE and DRSD before the lights out do not count (zandvoort-uid-reuse sends a
// DRSE and a DRSD in the formation lap); the lights out is the upstream `session-phase-race` leaving `grid`,
// `formation` and `startLights`. The DRSD of a safety car or VSC deployment says `wetTrack` in the recordings (reason 0).
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/race-control-race/machine.ts';
import type { SituationEvent } from '../../../src/signals/types.ts';
import { all, events, inPhase, LGOT, RACE } from '../session-phase/inputs.ts';
import { defineTransitionTable, inputs, type InputEdit, type TransitionRow } from '../../support/transition-table.ts';

/** The upstream session-phase span is of kind `kind` from this frame on (a race frame, C14). */
export const phase = (kind: string): InputEdit =>
  all(inPhase(RACE), (i: MachineInput) => {
    i.upstream['session-phase-race'] = [{ machine: 'session-phase-race', id: 0, kind, start: 0, startFrame: 1, confirmed: true, detail: {} }];
  });

/** A race frame in the session phase `kind`, edited further by `edits`. */
export const inRace = (kind: string, ...edits: InputEdit[]): InputEdit => all(phase(kind), ...edits);

export const DRSE: SituationEvent = { code: 'DRSE' };
/** A DRSD with the reason the signals module read. */
export const DRSD = (reason: 'wetTrack' | 'safetyCar' | 'redFlag' | 'minLapNotReached' | 'unknown'): SituationEvent => ({ code: 'DRSD', reason }) as SituationEvent; // 'unknown': the signals module adds it (supervisor change)
export { LGOT };

const rows: TransitionRow<MachineInput>[] = [
  { name: 'the first frame on the grid: drsOff, not enabled yet', from: 'none', to: 'drsOff', input: inputs().frame(phase('grid')) },
  { name: 'the first frame in the formation lap: drsOff, not enabled yet (join)', from: 'none', to: 'drsOff', input: inputs().frame(phase('formation')), join: true },
  { name: 'the first frame at the start lights: drsOff, not enabled yet (join)', from: 'none', to: 'drsOff', input: inputs().frame(phase('startLights')), join: true },
  { name: 'a race joined after the lights out: drsOn (join)', from: 'none', to: 'drsOn', input: inputs().frame(phase('racing')), join: true },
  {
    name: 'DRSE after the lights out: drsOff -> drsOn',
    from: 'drsOff',
    to: 'drsOn',
    input: inputs().frames(2, phase('grid')).frame(phase('startLights')).frame(inRace('racing', events(LGOT))).frames(3, phase('racing')).frame(events(DRSE)),
  },
  {
    name: 'DRSE after a DRSD: drsOff -> drsOn',
    from: 'drsOff',
    to: 'drsOn',
    input: inputs().frames(2, phase('racing')).frame(events(DRSD('safetyCar'))).frames(3).frame(events(DRSE)),
  },
  { name: 'DRSD after the lights out: drsOn -> drsOff', from: 'drsOn', to: 'drsOff', input: inputs().frames(3, phase('racing')).frame(events(DRSD('wetTrack'))) },
  {
    name: 'a DRSD with another reason while DRS is off: drsOff -> drsOff',
    from: 'drsOff',
    to: 'drsOff',
    input: inputs().frames(2, phase('racing')).frame(events(DRSD('wetTrack'))).frames(2).frame(events(DRSD('redFlag'))),
  },
  {
    name: 'a DRSD after the lights out while DRS is not enabled yet: drsOff -> drsOff',
    from: 'drsOff',
    to: 'drsOff',
    input: inputs().frames(2, phase('grid')).frame(phase('racing')).frames(2).frame(events(DRSD('minLapNotReached'))),
  },
];

export default defineTransitionTable(machine, rows);
