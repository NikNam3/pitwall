// The qualifying car-activity sub-machine's transition table (contract C9, C14, C15, C17, C18, C19, C85): the rows it
// shares with the practice machine (`car-activity-timed/rows.ts`, where the rules are), in the qualifying phase, its
// push kind `pushLap`. The declared transitions:
//   none -> garage, outLap, pushLap, inLap, finished, notCompeting     a car's first car-location span (joins)
//   outLap, pushLap, inLap, garage, finished -> notCompeting           car-status retired, disqualified or absent
//   notCompeting -> garage, outLap, pushLap, inLap, finished           car-status competing again (not yet seen)
//   outLap, pushLap, inLap, finished -> garage                         car-location garage (the box, teleports)
//   garage -> outLap                                                   leaving the garage
//   outLap -> pushLap                                                  the line on track
//   outLap -> inLap, pushLap -> inLap                                  heading for the pit lane; the session's end
//   inLap -> outLap                                                    the pit exit without the garage
//   outLap, pushLap, inLap -> finished                                 the line once the session has ended
import machine from '../../../src/situations/car-activity-qualifying/machine.ts';
import { defineTransitionTable } from '../../support/transition-table.ts';
import { QUALIFYING, timed } from '../car-activity-timed/inputs.ts';
import { timedActivityRows } from '../car-activity-timed/rows.ts';

export const qualifying = timed(QUALIFYING, 'session-phase-qualifying');

export default defineTransitionTable(machine, timedActivityRows(qualifying, 'pushLap'));
