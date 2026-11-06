// Gallery declaration of the track-map display (spec 7.2). Test-phase file: the implementer does not edit it.
// Zandvoort (the outline copied into fixtures.ts, C69) with a synthetic field. The first case is the screenshot baseline
// at each size (the mockup's scene without the ghost: a car in the pit lane, a yellow zone, a car shown blue, an
// incident); the others show one thing each. No recorded moment: the captured moments hold no track file.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { geometry, markers, noFile, trackCars, zones } from './fixtures.ts';
import type { widget } from './widget.ts';

const quiet = { geometry: geometry(), cars: trackCars(), markers: markers() };

/** Synthetic cases and fit expectations for `track-map`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: [],
  cases: {
    // the race: DOO in the pit lane (hollow), the zone after T11 yellow, BOR shown blue (lapped by the leaders), a
    // collision near T12; our cars KUH and LIN white and larger
    race: {
      geometry: geometry(),
      cars: trackCars({ DOO: { inPit: true }, BOR: { blueFlag: true } }, zones({ 7: 'yellow' })),
      markers: markers(['collision', 0.74]),
    },
    // no track file (or no outline): the panel says so
    noFile: { ...noFile },
    // a yellow zone (the one into T1) and a green one after it; the green draws nothing
    yellowZone: { ...quiet, cars: trackCars({}, zones({ 0: 'yellow', 1: 'green' })) },
    // a lapped rival and our car shown blue: each dot gets its side bar on a free side
    blueFlag: { ...quiet, cars: trackCars({ BOR: { blueFlag: true }, KUH: { blueFlag: true } }) },
    // two major incidents of the last laps, each an amber triangle with its kind
    incident: { ...quiet, markers: markers(['collision', 0.08], ['retirement', 0.53]) },
  },
};

export default gallery;
