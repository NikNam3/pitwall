// Gallery declaration of the pit-loss-table display (spec 6; mockup docs/design/2026-11-06-sp4.1a/source-badge.html).
// Test-phase file: the implementer does not edit it. The cases and fit sizes live in fixtures.ts, shared with the tests.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `pit-loss-table`. No recorded moment carries `pitLosses.track` yet. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, fit };

export default gallery;
