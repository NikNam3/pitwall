// Gallery declaration of the strategy-overview display (SP4.3d spec §6.4; mockup docs/design/2026-11-16-sp4.3d/strategy-overview.html).
// Test-phase file: the implementer does not edit it. The cases and fit sizes live in fixtures.ts, shared with the tests.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `strategy-overview`. No recorded moment carries `strategyOverview.car` yet. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, fit };

export default gallery;
