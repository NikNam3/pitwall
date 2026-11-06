// Gallery declaration of the raising-average-chart display (spec 4). Test-phase file: the implementer does not edit it.
// The cases come from fixtures.ts, where the tests read them too (C69). No recorded moment: the captured moments hold no
// raising average. A gallery case carries data only and the cell renders the declaration's default options (every rival
// `none`), so the race case shows our two cars; the mockup's rivals show in the component tests (`raceOptions`).
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `raising-average-chart`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: [],
  cases: { ...cases },
  // Spec 4 and the approved mockup: compact 36x8, full 60x14; the edge just below full is still compact.
  fit: [
    { mode: 'compact', cols: 36, rows: 8 },
    { mode: 'compact', cols: 59, rows: 13 },
    { mode: 'full', cols: 60, rows: 14 },
    { mode: 'full', cols: 90, rows: 20 },
  ],
};

export default gallery;
