// Keeps the acknowledgements in `ui.alerts` bounded (spec 7.7): an acknowledged occurrence that has ended is forgotten.
import { ackToken, type InsightEntry, type ServerMessage } from '@pitwall/contracts';
import type { FeedId, Insight } from '@pitwall/domain';
import type { TopicHub } from '../hub/topic-hub.ts';
import type { UiState } from './ui-state.ts';

const CLIENT_ID = 'bridge:ack-pruning';

/**
 * Follows the `insights` topic of `feeds` as an in-process hub client and, each time an insight is resolved, calls
 * `pruneAcknowledged` with the occurrences active on any of them. Only a resolve prunes: a session change or a restart
 * re-raises the feed's insights that still hold with their old `raisedAt`, so their acknowledgements must survive the
 * moment the log is empty. Subscribing to `insights` runs no extra calculator (insight calculators always run).
 * Returns the unsubscribe.
 */
export function pruneEndedAcknowledgements(hub: TopicHub, feeds: readonly FeedId[], state: Pick<UiState, 'pruneAcknowledged'>): () => void {
  const active = new Map<string, Map<string, Insight>>(feeds.map((feed) => [feed, new Map()]));
  const apply = (byKey: Map<string, Insight>, entries: readonly InsightEntry[]): boolean => {
    let resolved = false;
    for (const entry of entries) {
      if (entry.type === 'raised') byKey.set(entry.insight.key, entry.insight);
      else resolved = byKey.delete(entry.key) || resolved;
    }
    return resolved;
  };
  const send = (message: ServerMessage): void => {
    if (message.type !== 'snapshot' && message.type !== 'append') return;
    const byKey = active.get(message.id);
    if (byKey === undefined) return;
    const entries = (message.entries ?? []) as InsightEntry[];
    if (message.type === 'snapshot') {
      byKey.clear();
      apply(byKey, entries);
    } else if (apply(byKey, entries)) {
      state.pruneAcknowledged(new Set([...active.values()].flatMap((insights) => [...insights.values()].map(ackToken))));
    }
  };
  hub.addClient(CLIENT_ID, { send, bufferedAmount: () => 0 });
  for (const feed of feeds) hub.subscribe({ clientId: CLIENT_ID, id: feed, topic: 'insights', params: {}, feedId: feed });
  return () => hub.removeClient(CLIENT_ID);
}
