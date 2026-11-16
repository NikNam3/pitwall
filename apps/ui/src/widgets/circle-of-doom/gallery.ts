// Gallery declaration of the circle-of-doom display (SP4.3d spec §6.5; mockup docs/design/2026-11-16-sp4.3d/circle-of-doom.html).
// Test-phase file: the implementer does not edit it. The cases and fit sizes live in fixtures.ts, shared with the tests.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `circle-of-doom`. No recorded moment carries `circle.car` yet. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, fit };

export default gallery;
