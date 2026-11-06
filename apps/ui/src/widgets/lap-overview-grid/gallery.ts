// Gallery declaration of the lap-overview-grid display (spec 4; mockups docs/design/2026-10-30-sp4a-displays/4-longrun.html
// and docs/design/2026-11-06-sp4.1b/changes.html). Test-phase file: the implementer does not edit it. The cases and fit
// sizes live in fixtures.ts, shared with the tests.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `lap-overview-grid`. No recorded moment carries `lapOverview.car` yet. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, fit };

export default gallery;
