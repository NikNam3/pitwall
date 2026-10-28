import type { FeedStatus } from '@pitwall/contracts';
import type { FeedId, Insight, SessionTime } from '@pitwall/domain';
import type { FeedMetricsView } from '@pitwall/engine';

/** No packets for this long and the feed is stale. */
export const FEED_STALE_MS = 2000;
/** More incomplete frames than this share (percent) is packet loss. */
export const FEED_LOSS_PERCENT = 5;
/** Receive time over which the loss share is measured. */
export const FEED_WINDOW_MS = 10_000;

export const feedStatusOf = (feedId: FeedId, feed: FeedMetricsView): FeedStatus => ({
  feedId,
  connected: feed.connected,
  stale: feed.msSinceLastPacket >= FEED_STALE_MS,
  lossPercent: feed.lossPercent,
  latePackets: feed.latePackets,
  decodeErrors: feed.decodeErrors,
  packetsPerSecond: feed.packetsPerSecond,
  ...(feed.latencyMs !== undefined && { latencyMs: feed.latencyMs }),
  ...(feed.wrongFormat !== undefined && { wrongFormat: feed.wrongFormat }),
});

const feedInsight = (
  feedId: FeedId,
  at: SessionTime,
  kind: string,
  severity: Insight['severity'],
  params: Insight['params'],
): Insight => ({ key: kind, severity, category: 'feed', feedId, kind, params, raisedAt: at });

/** Problems with the feed itself; they hold before any session opens, so they are not calculator insights. */
export const feedInsights = (feedId: FeedId, feed: FeedMetricsView, at: SessionTime): Insight[] => {
  const insights: Insight[] = [];
  if (feed.msSinceLastPacket >= FEED_STALE_MS) {
    insights.push(feedInsight(feedId, at, 'feed.stale', 'advisory', { msSinceLastPacket: feed.msSinceLastPacket }));
  }
  if (feed.lossPercent > FEED_LOSS_PERCENT) {
    insights.push(feedInsight(feedId, at, 'feed.packetLoss', 'advisory', { lossPercent: feed.lossPercent }));
  }
  if (feed.wrongFormat !== undefined) {
    insights.push(feedInsight(feedId, at, 'feed.wrongFormat', 'critical', { format: feed.wrongFormat }));
  }
  return insights;
};
