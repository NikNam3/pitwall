// Gallery declaration of the plan-board display (SP4.3d spec §6.2, V17; mockup docs/design/2026-11-16-sp4.3d/plan-board.html).
// Test-phase file: the implementer does not edit it. The cases, their options and the fit sizes live in fixtures.ts,
// shared with the tests.
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import { caseOptions, cases, fit } from './fixtures.ts';
import type { widget } from './widget.ts';

/** Synthetic cases and fit expectations for `plan-board`. No recorded moment carries plan slots yet. */
const gallery: GalleryEntry<typeof widget> = { moments: [], cases, caseOptions, fit };

export default gallery;
