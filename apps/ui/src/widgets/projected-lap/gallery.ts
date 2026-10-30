// Gallery declaration of the projected-lap display (spec 9.1). Test-phase file: the implementer does not edit it.
import type { SessionInfo } from '@pitwall/contracts';
import { carId, feedId } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { insideCutOff, ms, outLap, outsideCutOff, projection } from './fixtures.ts';
import type { widget } from './widget.ts';

/** The projected car (car 1) is ours: its new personal best is green. */
const session = { feedId: feedId('gallery'), sessionUid: '1', playerCar: carId(1), realism: false } as SessionInfo;

/** Synthetic cases and fit expectations for `projected-lap`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceZandvoortLap10.crossing'],
  cases: {
    // Mockup: Q1 push lap inside the cut-off, a new personal best (green delta).
    insideCutOff: { projection: insideCutOff, session },
    // Projection outside the cut-off: red margin, positive delta to best.
    outsideCutOff: { projection: outsideCutOff, session },
    // Out lap: "out lap" in the PROJ row, the cut-off time and position, the finish margin only.
    outLap: { projection: outLap, session },
    // Practice: no cut-off row content, the finish margin of a timed session.
    practice: { projection: projection({ lapMs: 83_900, deltaMs: 240, position: 4, finishMs: 61_000 }), session },
    // The finish margin below zero: no further lap can start.
    finishBelowZero: { projection: projection({ lapMs: 83_900, deltaMs: 240, position: 4, finishMs: -4_100 }), session },
    // Nothing known yet (first lap of the session).
    nothingYet: { projection: projection(), session },
    // The finish margin alone (hidden values stay empty cells).
    finishOnly: { projection: { ...projection({ onLap: false }), finishMarginMs: ms(12_000) }, session },
  },
  // Task 22: sizes between the modes, one at each mode's minimum plus the edges just inside it.
  fit: [
    { mode: 'compact', cols: 29, rows: 2 },
    { mode: 'compact', cols: 41, rows: 3 },
    { mode: 'compact', cols: 41, rows: 8 },
    { mode: 'full', cols: 42, rows: 4 },
    { mode: 'full', cols: 60, rows: 8 },
  ],
};

export default gallery;
