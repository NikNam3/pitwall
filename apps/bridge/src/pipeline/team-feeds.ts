import type { CarId, FeedId, GivenDecision, TeamId } from '@pitwall/domain';

/** What a feed reported last: its session uid, and its player car's team once Participants name it. */
type FeedSeat = { sessionUid: string; team: TeamId | null };

/** A plan decision as the bridge hands it to a feed's engine (C76). */
export type PlanDecision = Extract<GivenDecision, { kind: 'planCommitted' | 'planCleared' }>;

/** The key of one team in one session. */
const teamKey = (seat: { sessionUid: string; team: TeamId }): string => `${seat.sessionUid}:${seat.team}`;

/**
 * The team's feeds (C1a): the feeds of one session uid whose player cars have the same team (Participants). Bookkeeping
 * of the bridge's feeds, no judgement (C43). Each `FeedPipeline` given it (option `teams`) tells it its session uid and its
 * player car's team as they change.
 */
export class TeamFeeds {
  readonly #seats = new Map<FeedId, FeedSeat>();
  /** Per team of a session, each car's newest plan decision (C76): what a feed joining the team later is handed. */
  readonly #plans = new Map<string, Map<CarId, PlanDecision>>();

  /** A plan decision committed from feed `feedId` for its team; kept as its car's newest. A feed without a team keeps none. */
  notePlan(feedId: FeedId, decision: PlanDecision): void {
    const seat = this.#seats.get(feedId);
    if (seat === undefined || seat.team === null) return;
    const key = teamKey({ sessionUid: seat.sessionUid, team: seat.team });
    const plans = this.#plans.get(key) ?? new Map<CarId, PlanDecision>();
    plans.set(decision.carId, decision);
    this.#plans.set(key, plans);
  }

  /** Each car's newest plan decision of feed `feedId`'s team, by car; none while its team is not known. */
  plansOf(feedId: FeedId): PlanDecision[] {
    const seat = this.#seats.get(feedId);
    if (seat === undefined || seat.team === null) return [];
    const plans = this.#plans.get(teamKey({ sessionUid: seat.sessionUid, team: seat.team }));
    return plans === undefined ? [] : [...plans.values()].sort((a, b) => a.carId - b.carId);
  }

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
