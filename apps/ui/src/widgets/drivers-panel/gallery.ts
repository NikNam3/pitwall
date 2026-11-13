// Gallery declaration of the drivers-panel display (SP4.3b spec §10; mockup docs/design/2026-11-12-sp4.3b/drivers-panel.html).
// Test-phase file: the implementer does not edit it. The cases and fit sizes live in fixtures.ts, shared with the tests.
// The mockup's open person picker, its new-person field and the rejected override are window-local states (C73, P17):
// component tests, no case.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `drivers-panel`. No recorded moment carries the drivers topics. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, fit };

export default gallery;
