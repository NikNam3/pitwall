// Gallery declaration of the calibration-panel display (spec 6; mockup docs/design/2026-11-06-sp4.1a/calibration-panel.html).
// Test-phase file: the implementer does not edit it. The cases and fit sizes live in fixtures.ts, shared with the tests.
// The mockup's opened source and its rejected override are window-local states (C73): no case can show them.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `calibration-panel`. No recorded moment carries the calibration topics. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, fit };

export default gallery;
