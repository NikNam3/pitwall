import type { Insight } from '@pitwall/domain';

/**
 * What an acknowledgement in `ui.alerts` names: one occurrence of an insight, `<feedId>:<insightKey>:<raisedAt>`.
 * The same condition raised again later (another `raisedAt`) or on another feed is a new occurrence and shows again.
 */
export const ackToken = (insight: Pick<Insight, 'feedId' | 'key' | 'raisedAt'>): string => `${insight.feedId}:${insight.key}:${insight.raisedAt}`;
