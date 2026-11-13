// Gallery declaration of the pit-sweep-table display (SP4.3b spec §10; mockup docs/design/2026-11-12-sp4.3b/pit-sweep-table.html).
// Test-phase file: the implementer does not edit it. The cases, options and fit sizes live in fixtures.ts, shared with the tests.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { caseOptions, cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `pit-sweep-table`. No recorded moment carries `pitSweep.car` yet. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, caseOptions, fit };

export default gallery;
