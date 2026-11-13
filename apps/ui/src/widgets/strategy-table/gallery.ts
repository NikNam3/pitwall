// Gallery declaration of the strategy-table display (SP4.3b spec §10; mockup docs/design/2026-11-12-sp4.3b/strategy-table-b.html).
// Test-phase file: the implementer does not edit it. The cases and fit sizes live in fixtures.ts, shared with the tests.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `strategy-table`. No recorded moment carries `strategy.car` yet. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, fit };

export default gallery;
