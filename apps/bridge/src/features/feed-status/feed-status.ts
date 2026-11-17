import type { FeedStatus } from '@pitwall/contracts';
import type { FeedId, Insight, SessionTime } from '@pitwall/domain';
import type { FeedMetricsView } from '@pitwall/engine/readers';

/** No packets for this long and the feed is stale. */
export const FEED_STALE_MS = 2000;
/** More incomplete frames than this share (percent) is packet loss. */
export const FEED_LOSS_PERCENT = 5;
/** Fewer closed frames than this in the loss window (one second at 60 Hz) are too few to judge loss. */
export const FEED_MIN_LOSS_FRAMES = 60;
/** Receive time over which the loss share is measured. */
export const FEED_WINDOW_MS = 10_000;

const isStale = (feed: FeedMetricsView): boolean => feed.msSinceLastPacket >= FEED_STALE_MS;

/** Packet loss is only judged on a big enough sample; a feed that does not count the window's frames is always judged. */
const isLossy = (feed: FeedMetricsView): boolean =>
  feed.lossPercent > FEED_LOSS_PERCENT && (feed.lossWindowFrames ?? FEED_MIN_LOSS_FRAMES) >= FEED_MIN_LOSS_FRAMES;

/** What the pipeline knows of the feed's sessions; a running session's feature leaves it out (both read as `false`). */
export type FeedSessionState = {
  /** The feed's session ended and its packets are ignored (C59). */
  sessionEnded: boolean;
  /** From a session's end until the next session's first packet: silence then is no stale feed (C52). */
  betweenSessions: boolean;
};

export const feedStatusOf = (feedId: FeedId, feed: FeedMetricsView, sessions?: FeedSessionState): FeedStatus => ({
  feedId,
  ...(sessions !== undefined && { sessionEnded: sessions.sessionEnded }),
  betweenSessions: sessions?.betweenSessions ?? false,
  connected: feed.connected,
  stale: sessions?.betweenSessions !== true && isStale(feed),
  lossPercent: feed.lossPercent,
  latePackets: feed.latePackets,
  decodeErrors: feed.decodeErrors,
  packetsPerSecond: feed.packetsPerSecond,
  ...(feed.cadenceMs !== undefined && { cadenceMs: feed.cadenceMs }),
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

/**
 * Problems with the feed itself; they hold before any session opens, so they are not calculator insights. Between
 * sessions none is raised (C52), so one that held at the session's end is cleared then.
 */
export const feedInsights = (feedId: FeedId, feed: FeedMetricsView, at: SessionTime, betweenSessions = false): Insight[] => {
  if (betweenSessions) return [];
  const insights: Insight[] = [];
  if (isStale(feed)) {
    insights.push(feedInsight(feedId, at, 'feed.stale', 'advisory', { msSinceLastPacket: feed.msSinceLastPacket }));
  }
  if (isLossy(feed)) {
    insights.push(feedInsight(feedId, at, 'feed.packetLoss', 'advisory', { lossPercent: feed.lossPercent }));
  }
  if (feed.wrongFormat !== undefined) {
    insights.push(feedInsight(feedId, at, 'feed.wrongFormat', 'critical', { format: feed.wrongFormat }));
  }
  return insights;
};
