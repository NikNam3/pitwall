// The qualifying session-phase sub-machine's transition table (contract C9, C14, C17, C85): the rows it shares with the
// practice machine (`session-phase/timed-rows.ts`), in the qualifying phase.
import machine from '../../../src/situations/session-phase-qualifying/machine.ts';
import { defineTransitionTable } from '../../support/transition-table.ts';
import { QUALIFYING } from '../session-phase/inputs.ts';
import { timedSessionRows } from '../session-phase/timed-rows.ts';

export default defineTransitionTable(machine, timedSessionRows(QUALIFYING));
