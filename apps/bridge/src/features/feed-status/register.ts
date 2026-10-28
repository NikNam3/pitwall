import type { FeedStatus } from '@pitwall/contracts';
import type { QuickCalculator } from '@pitwall/engine';
import { bindState, defineFeature } from '../feature.ts';
import { feedStatusOf } from './feed-status.ts';

const feedStatus: QuickCalculator<FeedStatus> = {
  id: 'feed.status',
  kind: 'quick',
  reads: ['feed'],
  cadence: 'frame',
  compute: (view) => feedStatusOf(view.state.feedId, view.feed),
};

export default defineFeature({
  name: 'feed-status',
  calculators: [feedStatus],
  topics: [bindState('feed.status', feedStatus)],
});
