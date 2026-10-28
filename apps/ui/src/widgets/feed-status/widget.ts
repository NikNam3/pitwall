// Declaration of the feed-status display (spec 6.5): connection health of the telemetry feed.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';
import { boolOption } from '../../kit/options.ts';

export const widget = declareWidget({
  name: 'feed-status',
  title: 'Feed',
  data: { feed: topic('feed.status'), session: optional(topic('session.info')) },
  options: { details: boolOption(false, 'Show packet details') },
  sizes: { compact: { minCols: 24, minRows: 3 }, full: { minCols: 48, minRows: 8 } },
});
