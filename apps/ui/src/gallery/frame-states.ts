// The panel frame in each state it can show (spec 4.3): the cells of the gallery's frame section, as plain data.
import type { FeedStatus } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import type { GalleryOverride } from './gallery-connection.ts';

/** The widget the frame states are drawn with: its `feed` and `session` entries are the frame's own topics. */
export const FRAME_WIDGET = 'feed-status';

/** A widget name no build has. */
export const MISSING_WIDGET = 'no-such-widget';

const healthy: FeedStatus = {
  feedId: feedId('gallery'),
  connected: true,
  stale: false,
  lossPercent: 0,
  latePackets: 0,
  decodeErrors: 0,
  packetsPerSecond: 60,
  cadenceMs: 100,
};

/** One frame cell: `widget` false draws the unknown-widget panel; `overrides` decide the data. */
export type FrameState = { name: string; widget: boolean; overrides: GalleryOverride[] };

export const FRAME_STATES: readonly FrameState[] = [
  { name: 'noData', widget: true, overrides: [] },
  { name: 'errored', widget: true, overrides: [{ topic: 'feed.status', status: 'errored' }] },
  { name: 'stale', widget: true, overrides: [{ topic: 'feed.status', value: { ...healthy, stale: true } }] },
  { name: 'computed', widget: true, overrides: [{ topic: 'feed.status', value: { ...healthy, computedFor: { lap: 12, frameId: 1 } } }] },
  { name: 'unknownWidget', widget: false, overrides: [] },
];
