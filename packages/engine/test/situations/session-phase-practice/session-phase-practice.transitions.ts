// The practice session-phase sub-machine's transition table (contract C9, C14, C17, C85): the rows it shares with the
// qualifying machine (`session-phase/timed-rows.ts`), in the practice phase.
import machine from '../../../src/situations/session-phase-practice/machine.ts';
import { defineTransitionTable } from '../../support/transition-table.ts';
import { PRACTICE } from '../session-phase/inputs.ts';
import { timedSessionRows } from '../session-phase/timed-rows.ts';

export default defineTransitionTable(machine, timedSessionRows(PRACTICE));
