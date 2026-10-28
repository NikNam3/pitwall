import type { FeedId, SessionUid } from '@pitwall/domain';

/** One feed as announced in the `hello` message. */
export type FeedInfo = { feedId: FeedId; kind: 'udp' | 'replay'; label: string; sessionUid?: SessionUid };
