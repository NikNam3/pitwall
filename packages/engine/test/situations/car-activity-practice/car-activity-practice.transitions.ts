// The practice car-activity sub-machine's transition table (contract C9, C14, C15, C17, C18, C19, C85): the rows it
// shares with the qualifying machine (`car-activity-timed/rows.ts`, where the rules are), in the practice phase, its
// push kind `flyingLap`. The declared transitions:
//   none -> garage, outLap, flyingLap, inLap, finished, notCompeting   a car's first car-location span (joins)
//   outLap, flyingLap, inLap, garage, finished -> notCompeting         car-status retired, disqualified or absent
//   notCompeting -> garage, outLap, flyingLap, inLap, finished         car-status competing again (not yet seen)
//   outLap, flyingLap, inLap, finished -> garage                       car-location garage (the box, teleports)
//   garage -> outLap                                                   leaving the garage
//   outLap -> flyingLap                                                the line on track
//   outLap -> inLap, flyingLap -> inLap                                heading for the pit lane; the session's end
//   inLap -> outLap                                                    the pit exit without the garage
//   outLap, flyingLap, inLap -> finished                               the line once the session has ended
import machine from '../../../src/situations/car-activity-practice/machine.ts';
import { defineTransitionTable } from '../../support/transition-table.ts';
import { PRACTICE, timed } from '../car-activity-timed/inputs.ts';
import { timedActivityRows } from '../car-activity-timed/rows.ts';

export const practice = timed(PRACTICE, 'session-phase-practice');

export default defineTransitionTable(machine, timedActivityRows(practice, 'flyingLap'));
