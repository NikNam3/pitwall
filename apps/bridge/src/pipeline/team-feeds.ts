import type { FeedId } from '@pitwall/domain';

/**
 * The team's feeds (C1a): the feeds of one session uid whose player cars have the same team (Participants). Bookkeeping
 * of the bridge's feeds, no judgement (C43). Each `FeedPipeline` given it (option `teams`) tells it its session uid and its
 * player car's team as they change. Stub of the test phase (SP4.3b Task 2b); the implement phase fills it.
 */
export class TeamFeeds {
  /** The feeds in `feedId`'s team, `feedId` included; a feed whose team is not known is alone. */
  teamOf(_feedId: FeedId): FeedId[] {
    throw new Error('not implemented');
  }
}
