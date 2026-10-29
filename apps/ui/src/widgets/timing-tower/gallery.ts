// Gallery declaration of the timing-tower display (spec 9.1). Test-phase file: the implementer does not edit it.
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { RaceMoment } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { boardRow, incidentEntry, interval, lapBoard, overview, sessionInfo, toCar } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Our car (id 3, KUH) is fourth; SAR is a lap down; OCO has retired; ALB is on an out lap. */
const cars = [
  overview(0, { name: 'Max Verstappen', position: 1, gridPosition: 1 }),
  overview(1, { name: 'Lando Norris', position: 2, gridPosition: 3 }),
  overview(2, { name: 'Charles Leclerc', position: 3, gridPosition: 2, compound: 'hard', age: 23, numPitStops: 0, timePenaltyMs: 5000 }),
  overview(3, { name: 'Nikolas Kuhnlein', position: 4, gridPosition: 4, ours: true, age: 12 }),
  overview(4, { name: 'Alexander Albon', position: 5, gridPosition: 7, compound: 'hard', age: 1, driverStatus: 'outLap' }),
  overview(5, { name: 'Oscar Piastri', position: 6, gridPosition: 5, age: 15 }),
  overview(6, { name: 'Carlos Sainz', position: 7, gridPosition: 7, compound: 'hard', age: 30, numPitStops: 0, lap: 22 }),
  overview(7, { name: 'Esteban Ocon', position: 8, gridPosition: 8, resultStatus: 'didNotFinish', lap: 23 }),
];

const intervals = [
  interval(0), interval(1, 2184, 2184, 0, 1), interval(2, 5903, 3719, 0, -1), interval(3, 9102, 3199),
  interval(4, 14_880, 5778, 0, 2), interval(5, 16_025, 1145, 0, -1), interval(6, 70_000, 5000, 1), interval(7),
];
const toUs = [
  toCar(0, -9102), toCar(1, -6918), toCar(2, -3199), toCar(3, undefined), toCar(4, 5778), toCar(5, 6923), toCar(6, undefined, 1), toCar(7, undefined),
];
const board = lapBoard(3, [
  boardRow(0, 104_912, [28_104, 41_311, 35_497], ['sessionBest', 'none', 'none']),
  boardRow(1, 105_031, [28_211, 41_402, 35_418]),
  boardRow(2, 105_208, [28_240, 41_630, 35_338], ['none', 'none', 'sessionBest']),
  boardRow(3, 104_876, [28_150, 41_288, 35_438], ['none', 'sessionBest', 'personalBest'], 'personalBest'),
  boardRow(4, undefined, [28_320]),
  boardRow(5, 105_660, [28_402, 41_771, 35_487]),
  boardRow(6, 106_902, [28_771, 42_004, 36_127]),
  boardRow(7, undefined),
]);

const moment = (m: RaceMoment['moment']): RaceMoment => ({
  moment: m, since: known(toSessionTime(900), toSessionTime(900)), cause: { rule: 'majorIncident', params: {} }, active: [m],
});

const field = { cars, intervals, toCar: toUs, board, moment: undefined, session: sessionInfo(3), incidents: undefined };

/** Synthetic cases and fit expectations for `timing-tower`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceSingaporeStart.grid', 'ttZandvoortLap1.crossing'],
  cases: {
    // Incident moment: SAR and OCO are in the newest major incident, amber left bar on their rows.
    incidentMoment: {
      ...field,
      moment: known(moment('incident'), toSessionTime(900)),
      incidents: [incidentEntry('collision-6-7', 'major', [6, 7])],
    },
    // Lapped car (+1 lap) and a retired car dim at the bottom, our car marked.
    lappedAndRetired: field,
    // A rival whose times are withheld by realism mode: empty cells, the row still renders.
    realismHiddenRival: {
      ...field,
      board: lapBoard(3, [
        ...board.rows.filter((r) => r.carId !== carId(1)),
        boardRow(1, 'realism'),
      ]),
    },
    // Another current moment: the same incident carries no bar.
    battleMoment: {
      ...field,
      moment: known(moment('battle'), toSessionTime(900)),
      incidents: [incidentEntry('collision-6-7', 'major', [6, 7])],
    },
    // Outside the race the moment is not applicable.
    noMoment: { ...field, moment: unknown('notApplicable') },
  },
  // Task 22: sizes between the modes, one at each mode's minimum plus the edges just inside it.
  fit: [
    { mode: 'compact', cols: 30, rows: 6 },
    { mode: 'compact', cols: 50, rows: 8 },
    { mode: 'compact', cols: 83, rows: 20 },
    { mode: 'full', cols: 84, rows: 9 },
    { mode: 'full', cols: 100, rows: 22 },
  ],
};

export default gallery;
