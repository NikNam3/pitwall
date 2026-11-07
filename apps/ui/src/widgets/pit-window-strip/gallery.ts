// Gallery declaration of the pit-window-strip display (SP4.2 spec §4; mockup docs/design/2026-11-07-sp4.2/pit-window.html).
// Test-phase file: the implementer does not edit it. The cases, options and fit sizes live in fixtures.ts, shared with the tests.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { caseOptions, cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `pit-window-strip`. No recorded moment carries `pitWindow.car` yet. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, caseOptions, fit };

export default gallery;
