import type { FeedId, SessionUid, TeamId } from '@pitwall/domain';

/** One feed as announced in the `hello` message; `team` its player car's team, `null` until Participants name it. */
export type FeedInfo = { feedId: FeedId; kind: 'udp' | 'replay'; label: string; sessionUid?: SessionUid; team: TeamId | null };
