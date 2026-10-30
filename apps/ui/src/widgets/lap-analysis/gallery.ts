// Gallery declaration of the lap-analysis display (spec 9.1). Test-phase file: the implementer does not edit it.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { KUH, LEC, NOR, PIA, VER, boardRow, cars, lapBoard, sessionBests, sessionInfo } from './fixtures.ts';
import type { widget } from './widget.ts';

const ours = boardRow(1, KUH, KUH);
const others = [boardRow(2, NOR, KUH), boardRow(3, LEC, KUH), boardRow(4, PIA, KUH)];
const rows = [ours, boardRow(0, VER, KUH), ...others];
const field = { board: lapBoard(1, rows, sessionBests), cars, session: sessionInfo(1) };

/** Synthetic cases and fit expectations for `lap-analysis`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceZandvoortLap10.crossing', 'raceSingaporeStart.grid'],
  cases: {
    // The mockup: the reference row in absolute times, deltas below, purple session bests (no green: every value is a personal best).
    mockup: field,
    // A rival whose times are withheld by realism mode: empty cells, the row still renders.
    realismHiddenRival: { ...field, board: lapBoard(1, [ours, boardRow(0, 'realism', KUH), ...others], sessionBests) },
    // Early in the session: no session bests yet and a car without a time.
    noBestsYet: { ...field, board: lapBoard(1, [ours, boardRow(2, 'noTimes', KUH)]) },
    // The teammate (car 3) is ours too: its code takes the own-car colour.
    teammate: { ...field, session: sessionInfo(1, 3) },
  },
  // Task 22: sizes between the modes, one at each mode's minimum plus the edges just inside it.
  fit: [
    { mode: 'compact', cols: 22, rows: 4 },
    { mode: 'compact', cols: 43, rows: 5 },
    { mode: 'compact', cols: 43, rows: 12 },
    { mode: 'full', cols: 44, rows: 6 },
    { mode: 'full', cols: 60, rows: 12 },
  ],
};

export default gallery;
