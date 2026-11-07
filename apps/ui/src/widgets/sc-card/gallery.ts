// Gallery declaration of the sc-card display (SP4.2 spec 4; mockup docs/design/2026-11-07-sp4.2/sc-card.html).
// Test-phase file: the implementer does not edit it. The cases and fit sizes live in fixtures.ts, shared with the tests.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `sc-card`. No recorded moment carries `scCall.car` yet. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, fit };

export default gallery;
