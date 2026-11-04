// The race's session-phase sub-machine's transition table (contract C9, C14, C17, C18, C36, C85), ported from the
// legacy tracker (`history/situations/session-phase.ts`) with the signal orders of the inventory
// (docs/research/09-situations-inventory.md §1.1-1.7, §7). The spans tile the session from the first frame the machine
// runs (the weekend phase decided, C14): `grid`, `formation` (the formation status), `startLights` (the first start
// light, from the grid, the formation lap or a red flag's standing restart), `racing` (lights out), `neutralised` (a
// SCAR deployment opens it at once, unconfirmed until the safety car status shows its car, C18; the status alone opens
// it too), `suspended` (a red flag), `finished` (the race winner or the chequered flag), `postSession` (SEND, or the
// clock's simulated end, C36). A session joined in progress opens its current phase with `joinedAt` (Review Focus 2):
// the formation status, an SC or VSC status, or a race under way (the leader past lap 1, or a lap timer above 1000 ms).
// The end of a session is a signal, never the final classification's arrival (user ruling, Task 9).
import machine from '../../../src/situations/session-phase-race/machine.ts';
import { defineTransitionTable, inputs, type InputEdit, type TransitionRow } from '../../support/transition-table.ts';
import {
  all,
  CHQF,
  events,
  inPhase,
  LGOT,
  leader,
  RACE,
  RCWN,
  RDFL,
  scar,
  SEND,
  simulatedEnd,
  status,
  STLG,
  timerOfCar1,
  underWay,
} from '../session-phase/inputs.ts';

/** A race frame, edited further by `edits`. */
const race = (...edits: InputEdit[]): InputEdit => all(inPhase(RACE), ...edits);

/** The session's first frame on a fresh grid: the clock held at 0, no status, every lap timer at 0. */
const onGrid = () => inputs().frame(race((i) => (i.at = 0)));
/** The grid, then the formation status. */
const inFormation = () => onGrid().frame(race(status('formation')));
/** The grid, then the first start light. */
const inStartLights = () => onGrid().frame(race(events(STLG(1))));
/** A race joined under way. */
const racing = () => inputs().frame(race(underWay));
/** Racing, then an SC deployed and confirmed by the status. */
const underSc = () => racing().frame(race(events(scar('SC', 'deployed')))).frame(race(status('sc')));
/** Racing, then a red flag. */
const suspended = () => racing().frame(race(events(RDFL)));
/** Racing, then the race winner. */
const finished = () => racing().frame(race(events(RCWN)));

const rows: TransitionRow[] = [
  // The session's first frame (C14: the first frame the machine runs).
  { name: 'the first frame on a fresh grid opens grid', from: 'none', to: 'grid', input: onGrid() },
  { name: 'joins in the formation lap: the first frame shows the formation status', from: 'none', to: 'formation', input: inputs().frame(race(status('formation'))), join: true },
  { name: 'joins a race under way: the leader past lap 1', from: 'none', to: 'racing', input: inputs().frame(race(leader(3, 0))), join: true },
  { name: 'joins a race under way: a lap timer above 1000 ms', from: 'none', to: 'racing', input: inputs().frame(race(leader(1, 1_016))), join: true },
  { name: 'joins under the safety car: the first frame shows the SC status', from: 'none', to: 'neutralised', input: inputs().frame(race(underWay, status('sc'))), join: true },
  { name: 'joins under the virtual safety car: the first frame shows the VSC status', from: 'none', to: 'neutralised', input: inputs().frame(race(underWay, status('vsc'))), join: true },

  // The start (§1.1-1.3, §7).
  { name: 'the formation status on the grid opens the formation lap (S2-S4)', from: 'grid', to: 'formation', input: inFormation() },
  { name: 'the first start light on the grid opens the start lights (S1, no formation lap)', from: 'grid', to: 'startLights', input: inStartLights() },
  {
    name: 'on the grid a lap timer above 1000 ms is a race under way: a join after the last start light saw none (B1)',
    from: 'grid',
    to: 'racing',
    input: onGrid().frame(race(timerOfCar1(510))).frame(race(leader(1, 1_016))),
  },
  {
    name: 'the first start light after the formation lap opens the start lights; the formation status still stands (§7)',
    from: 'formation',
    to: 'startLights',
    input: inFormation().frame(race(events(STLG(1)))),
  },
  {
    name: 'lights out ends the start lights and opens racing',
    from: 'startLights',
    to: 'racing',
    input: inStartLights().frame(race(events(STLG(2)))).frame(race(events(LGOT))),
  },

  // A neutralisation (§1.4; Review Focus 5: the SCAR before the status).
  { name: 'an SC deployment opens a neutralisation at once, before the status shows it', from: 'racing', to: 'neutralised', input: racing().frame(race(events(scar('SC', 'deployed')))) },
  { name: 'a VSC deployment opens a neutralisation at once', from: 'racing', to: 'neutralised', input: racing().frame(race(events(scar('VSC', 'deployed')))) },
  { name: 'the SC status without a deployment event opens a neutralisation on its frame', from: 'racing', to: 'neutralised', input: racing().frame(race(status('sc'))) },
  { name: 'the SC resume closes the neutralisation and opens racing', from: 'neutralised', to: 'racing', input: underSc().frame(race(events(scar('SC', 'resume')))) },
  { name: 'the status going green closes a confirmed neutralisation before its resume', from: 'neutralised', to: 'racing', input: underSc().frame(race(status('green'))) },
  {
    name: 'a deployment the status never confirms closes 3 s after its SCAR, confirmed false, and racing opens again (C18)',
    from: 'neutralised',
    to: 'racing',
    input: racing().frame(race(events(scar('SC', 'deployed')))).frames(187, race()).frame(race()),
  },
  {
    name: 'an SC deployed under a VSC closes the VSC and opens the SC (§1.4, MiR, ZvR2)',
    from: 'neutralised',
    to: 'neutralised',
    input: racing().frame(race(events(scar('VSC', 'deployed')))).frame(race(status('vsc'))).frame(race(events(scar('SC', 'deployed')))),
  },

  // A red flag (§1.12, §4: not yet seen; C19).
  { name: 'a red flag suspends the race', from: 'racing', to: 'suspended', input: suspended() },
  { name: 'a red flag under the safety car suspends the race', from: 'neutralised', to: 'suspended', input: underSc().frame(race(events(RDFL))) },
  { name: 'a standing restart: the first start light after a red flag opens the start lights', from: 'suspended', to: 'startLights', input: suspended().frame(race(events(STLG(1)))) },
  { name: 'a rolling restart: the SC status after a red flag closes the suspension and opens the SC', from: 'suspended', to: 'neutralised', input: suspended().frame(race(status('sc'))) },

  // The finish (§1.5).
  { name: 'the race winner finishes a race under way', from: 'racing', to: 'finished', input: finished() },
  { name: 'the chequered flag without a race winner finishes a race under way', from: 'racing', to: 'finished', input: racing().frame(race(events(CHQF))) },
  { name: 'the chequered flag under the safety car finishes the race', from: 'neutralised', to: 'finished', input: underSc().frame(race(events(CHQF))) },
  { name: 'the race winner under a red flag finishes the race', from: 'suspended', to: 'finished', input: suspended().frame(race(events(RCWN))) },

  // The session's end (§1.6-1.7, Review Focus 3): SEND, or the clock's simulated end; never the classification.
  { name: 'SEND on the grid opens the post-session', from: 'grid', to: 'postSession', input: onGrid().frame(race((i) => (i.at = 0), events(SEND))) },
  { name: 'SEND in the formation lap opens the post-session', from: 'formation', to: 'postSession', input: inFormation().frame(race(events(SEND))) },
  { name: 'SEND in the start lights opens the post-session', from: 'startLights', to: 'postSession', input: inStartLights().frame(race(events(SEND))) },
  { name: 'SEND mid-race (quit) opens the post-session, no finish (SgR, SgW)', from: 'racing', to: 'postSession', input: racing().frame(race(events(SEND))) },
  {
    name: 'the clock’s simulated end opens the post-session (the online shape with the UID-0 classification: ZvR, ZvR2)',
    from: 'racing',
    to: 'postSession',
    input: racing().frame(race(simulatedEnd)),
  },
  { name: 'SEND under the safety car opens the post-session', from: 'neutralised', to: 'postSession', input: underSc().frame(race(events(SEND))) },
  {
    name: 'the simulated end while a deployment waits: the neutralisation closes confirmed false and the post-session opens (ZvR2)',
    from: 'neutralised',
    to: 'postSession',
    input: racing().frame(race(events(scar('SC', 'deployed')))).frame(race(simulatedEnd)),
  },
  { name: 'SEND under a red flag opens the post-session', from: 'suspended', to: 'postSession', input: suspended().frame(race(events(SEND))) },
  { name: 'SEND after the finish opens the post-session (MxR, MiR)', from: 'finished', to: 'postSession', input: finished().frame(race(events(SEND))) },
];

export default defineTransitionTable(machine, rows);
