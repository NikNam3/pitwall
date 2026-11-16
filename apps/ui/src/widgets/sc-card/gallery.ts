// Gallery declaration of the sc-card display, the Box call (SP4.3d spec §6.3, V18 reworked; mockup
// docs/design/2026-11-16-sp4.3d/sc-card.html). Test-phase file: the implementer does not edit it. The cases and fit
// sizes live in fixtures.ts, shared with the tests.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `sc-card`. No recorded moment carries `scCall.car` yet. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, fit };

export default gallery;
