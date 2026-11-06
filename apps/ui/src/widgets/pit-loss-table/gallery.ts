// Gallery declaration of the pit-loss-table display (spec 6; mockup docs/design/2026-11-06-sp4.1a/source-badge.html).
// Test-phase file: the implementer does not edit it.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import {
  ANT, BEA, HAD, KUH, calibrationSource, cars, defaultSource, estimate, losses, mockupConditions, mockupStops, sessionInfo, stop,
} from './fixtures.ts';
import type { widget } from './widget.ts';

const base = { cars, session: sessionInfo() };

/** Synthetic cases and fit expectations for `pit-loss-table`. No recorded moment carries `pitLosses.track` yet. */
const gallery: GalleryEntry<typeof widget> = {
  moments: [],
  cases: {
    // The mockup (first case: the screenshot baseline, Task 18): green measured this session from 6 stops (no mark,
    // SOURCE "session"), VSC from the set `league` (ᶜ, "calibration"), SC the track file's default (ᵈ, "default",
    // muted, stationary unknown); the six stops newest first, LIN ours.
    measured: { ...base, losses: losses() },
    // Lights out on the set `league`: every condition from the calibration, no stop yet.
    calibration: {
      ...base,
      losses: losses({
        green: estimate(20_400, 2_400, 0, calibrationSource('3 stops (race 15 Oct, FP2 14 Oct) · 0 stops this session')),
        vsc: estimate(13_400, 2_500, 0, calibrationSource()),
        sc: estimate(9_800, undefined, 0, defaultSource),
      }, []),
    },
    // A track without a calibration set: every condition is the track file's default, every row muted, no stop yet.
    defaultsOnly: {
      ...base,
      losses: losses({
        green: estimate(21_000, undefined, 0, defaultSource),
        vsc: estimate(13_000, undefined, 0, defaultSource),
        sc: estimate(9_800, undefined, 0, defaultSource),
      }, []),
    },
    // A stop without clean reference laps (HAD, lap 21): no loss (the unknown mark), the row faint with why on hover.
    noReferenceStop: { ...base, losses: losses(mockupConditions, [...mockupStops, stop(HAD, 21, undefined, 2_400, 'noReference')]) },
    // A stop that served a penalty (KUH, lap 22): its loss shown but faint, not counted, why on hover (R12).
    penaltyStop: { ...base, losses: losses(mockupConditions, [...mockupStops, stop(KUH, 22, 25_700, 7_500, 'penalty')]) },
    // Stops under VSC and SC this session, our player's among them.
    neutralisedStops: {
      ...base,
      losses: losses(mockupConditions, [...mockupStops, stop(ANT, 30, 13_100, 2_400, 'used', 'vsc'), stop(BEA, 31, 9_600, 2_500, 'used', 'sc'), stop(KUH, 31, 9_900, 2_300, 'used', 'sc')]),
    },
  },
  // The two minimums plus sizes just inside each mode: compact one column short of full, full taller than its minimum.
  fit: [
    { mode: 'compact', cols: 18, rows: 3 },
    { mode: 'compact', cols: 31, rows: 12 },
    { mode: 'full', cols: 32, rows: 13 },
    { mode: 'full', cols: 40, rows: 20 },
  ],
};

export default gallery;
