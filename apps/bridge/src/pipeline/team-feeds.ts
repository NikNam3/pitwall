import type { FeedId, TeamId } from '@pitwall/domain';

/** What a feed reported last: its session uid, and its player car's team once Participants name it. */
type FeedSeat = { sessionUid: string; team: TeamId | null };

/**
 * The team's feeds (C1a): the feeds of one session uid whose player cars have the same team (Participants). Bookkeeping
 * of the bridge's feeds, no judgement (C43). Each `FeedPipeline` given it (option `teams`) tells it its session uid and its
 * player car's team as they change.
 */
export class TeamFeeds {
  readonly #seats = new Map<FeedId, FeedSeat>();

  /** Feed `feedId` runs session `sessionUid` with its player car on `team` (`null` before Participants). */
  report(feedId: FeedId, sessionUid: string, team: TeamId | null): void {
    this.#seats.set(feedId, { sessionUid, team });
  }

  /** Feed `feedId` has left: it is in no team. */
  remove(feedId: FeedId): void {
    this.#seats.delete(feedId);
  }

  /** The player car's team of feed `feedId`; `null` before its Participants. */
  team(feedId: FeedId): TeamId | null {
    return this.#seats.get(feedId)?.team ?? null;
  }

  /** The feeds in `feedId`'s team, `feedId` included; a feed whose team is not known is alone. */
  teamOf(feedId: FeedId): FeedId[] {
    const own = this.#seats.get(feedId);
    if (own === undefined || own.team === null) return [feedId];
    const team: FeedId[] = [];
    for (const [id, seat] of this.#seats) {
      if (seat.sessionUid === own.sessionUid && seat.team === own.team) team.push(id);
    }
    return team;
  }
}
