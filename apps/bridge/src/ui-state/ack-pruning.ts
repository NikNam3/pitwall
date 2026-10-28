// Keeps the acknowledgements in `ui.alerts` bounded (spec 7.7): an acknowledged occurrence that has ended is forgotten.
import { ackToken, type InsightEntry, type ServerMessage } from '@pitwall/contracts';
import type { FeedId, Insight } from '@pitwall/domain';
import type { TopicHub } from '../hub/topic-hub.ts';
import type { UiState } from './ui-state.ts';

const CLIENT_ID = 'bridge:ack-pruning';

/**
 * True when `token` names an occurrence on `feed` raised at or before `at` (it has been reached, so if it is not
 * active it has ended), or is no occurrence token at all (a bare key from an older UI acknowledges nothing).
 */
function passedBy(token: string, feed: FeedId, at: number): boolean {
  const cut = token.lastIndexOf(':');
  const raisedAt = Number(token.slice(cut + 1));
  if (token.indexOf(':') === cut || token.slice(cut + 1) === '' || !Number.isFinite(raisedAt)) return true;
  return token.startsWith(`${feed}:`) && raisedAt <= at;
}

/**
 * Follows the `insights` topic of `feeds` as an in-process hub client. Each resolve on a feed prunes the acknowledged
 * occurrences of that feed whose time has passed (raised at or before the resolve) and that are not active. A replay
 * that runs again from the start (a backward jump, a dev restart) raises the same occurrences with the same
 * `raisedAt`, so an occurrence it has not reached yet keeps its acknowledgement. A snapshot (reset, flashback,
 * startup) never prunes. Subscribing to `insights` runs no extra calculator (insight calculators always run).
 * Returns the unsubscribe.
 */
export function pruneEndedAcknowledgements(hub: TopicHub, feeds: readonly FeedId[], state: Pick<UiState, 'pruneAcknowledged'>): () => void {
  const active = new Map<string, Map<string, Insight>>(feeds.map((feed) => [feed, new Map()]));
  const send = (message: ServerMessage): void => {
    if (message.type !== 'snapshot' && message.type !== 'append') return;
    const feed = feeds.find((f) => f === message.id);
    const byKey = active.get(message.id);
    if (feed === undefined || byKey === undefined) return;
    if (message.type === 'snapshot') byKey.clear();
    for (const entry of (message.entries ?? []) as InsightEntry[]) {
      if (entry.type === 'raised') {
        byKey.set(entry.insight.key, entry.insight);
        continue;
      }
      byKey.delete(entry.key);
      if (message.type === 'append') {
        const still = new Set([...byKey.values()].map(ackToken));
        state.pruneAcknowledged(still, (token) => passedBy(token, feed, entry.at));
      }
    }
  };
  hub.addClient(CLIENT_ID, { send, bufferedAmount: () => 0 });
  for (const feed of feeds) hub.subscribe({ clientId: CLIENT_ID, id: feed, topic: 'insights', params: {}, feedId: feed });
  return () => hub.removeClient(CLIENT_ID);
}
