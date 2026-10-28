/* eslint-disable @typescript-eslint/no-explicit-any -- `any` is the wildcard of the widget contract's WidgetDecl */
// What a panel subscribes to (spec 4.3): its widget's data entries, worked out from the link and the options.
import { TOPICS, type Fold, type TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import type { TopicKey } from '../../connection/topic-store.svelte.ts';
import type { AnyDataDecl, ResolvedLink, WidgetDecl } from '../../kit/types.ts';

/** One acquisition a panel holds. `id` is equal for equal requests, so a changed set only touches what changed. */
export type DataRequest = {
  /** The data entry's name, as the component receives it; the topic name for the frame's own topics. */
  name: string;
  key: TopicKey<TopicName>;
  fold: Fold<any, any> | undefined;
  optional: boolean;
  id: string;
};

/** The key of `topic` for `feedId`; global topics (`ui.*`) carry no feed. */
function keyOf(topic: TopicName, params: object, feedId: FeedId): TopicKey<TopicName> {
  const global = TOPICS[topic].scope === 'global';
  return (global ? { topic, params } : { topic, params, feedId }) as TopicKey<TopicName>;
}

const idOf = (name: string, key: TopicKey<TopicName>): string => JSON.stringify([name, key.feedId ?? null, key.topic, key.params]);

/** The acquisitions of every data entry of `decl`. */
export function dataRequests(decl: WidgetDecl<any, any>, link: ResolvedLink, options: Readonly<Record<string, unknown>>): DataRequest[] {
  return Object.entries(decl.data as Record<string, AnyDataDecl>).map(([name, entry]) => {
    const key = keyOf(entry.topic, entry.params?.({ link, options }) ?? {}, link.feedId);
    const optional = (entry as { optional?: boolean }).optional === true;
    return { name, key, fold: entry.fold, optional, id: idOf(name, key) };
  });
}

/** The panel frame's own acquisitions for a feed: the session clock and the feed's health (spec 6.4). */
export function frameRequests(feedId: FeedId): { session: DataRequest; feed: DataRequest } {
  const request = (topic: TopicName): DataRequest => {
    const key = keyOf(topic, {}, feedId);
    return { name: topic, key, fold: undefined, optional: true, id: idOf('', key) };
  };
  return { session: request('session.info'), feed: request('feed.status') };
}
