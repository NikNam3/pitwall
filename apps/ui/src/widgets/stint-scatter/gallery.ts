// Gallery declaration of the stint-scatter display (spec 6). Test-phase file: the implementer does not edit it.
// The cases come from fixtures.ts, where the tests read them too (C69). No recorded moment: the captured moments hold no
// stint analysis.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `stint-scatter`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: [],
  cases: { ...cases },
  // Mockup sizes (README): compact 36x8, full 72x16; the edge just below full is still compact.
  fit: [
    { mode: 'compact', cols: 36, rows: 8 },
    { mode: 'compact', cols: 71, rows: 15 },
    { mode: 'full', cols: 72, rows: 16 },
    { mode: 'full', cols: 96, rows: 24 },
  ],
};

export default gallery;
