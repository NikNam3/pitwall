import { PLAN_SLOTS, type CarId, type FeedId, type GivenDecision, type Slot, type TeamId } from '@pitwall/domain';

/** What a feed reported last: its session uid, and its player car's team once Participants name it. */
type FeedSeat = { sessionUid: string; team: TeamId | null };

/** A plan decision as the bridge hands it to a feed's engine (C76). */
export type PlanDecision = Extract<GivenDecision, { kind: 'planCommitted' | 'planCleared' | 'planSaved' | 'planRemoved' }>;

/** What a car's plan decisions leave for a feed that joins later (C76): its saved slots and its active plan. */
type CarPlans = { slots: Map<Slot, Extract<PlanDecision, { kind: 'planSaved' }>>; active: Extract<PlanDecision, { kind: 'planCommitted' | 'planCleared' }> | undefined };

/** The key of one team in one session. */
const teamKey = (seat: { sessionUid: string; team: TeamId }): string => `${seat.sessionUid}:${seat.team}`;

/**
 * The team's feeds (C1a): the feeds of one session uid whose player cars have the same team (Participants). Bookkeeping
 * of the bridge's feeds, no judgement (C43). Each `FeedPipeline` given it (option `teams`) tells it its session uid and its
 * player car's team as they change.
 */
export class TeamFeeds {
  readonly #seats = new Map<FeedId, FeedSeat>();
  /**
   * Per team of a session and per car, the newest `planSaved` of each slot not removed since, and the newest
   * `planCommitted` or `planCleared` (C76): what a feed joining the team later is handed.
   */
  readonly #plans = new Map<string, Map<CarId, CarPlans>>();

  /** A plan decision committed from feed `feedId` for its team, kept as above. A feed without a team keeps none. */
  notePlan(feedId: FeedId, decision: PlanDecision): void {
    const seat = this.#seats.get(feedId);
    if (seat === undefined || seat.team === null) return;
    const key = teamKey({ sessionUid: seat.sessionUid, team: seat.team });
    const plans = this.#plans.get(key) ?? new Map<CarId, CarPlans>();
    const car = plans.get(decision.carId) ?? { slots: new Map(), active: undefined };
    if (decision.kind === 'planSaved') car.slots.set(decision.slot, decision);
    else if (decision.kind === 'planRemoved') car.slots.delete(decision.slot);
    else car.active = decision;
    plans.set(decision.carId, car);
    this.#plans.set(key, plans);
  }

  /**
   * The plan decisions of feed `feedId`'s team that a joining feed is handed, by car: its saved slots in `PLAN_SLOTS`
   * order, then its active plan decision; none while its team is not known.
   */
  plansOf(feedId: FeedId): PlanDecision[] {
    const seat = this.#seats.get(feedId);
    if (seat === undefined || seat.team === null) return [];
    const plans = this.#plans.get(teamKey({ sessionUid: seat.sessionUid, team: seat.team }));
    if (plans === undefined) return [];
    return [...plans.entries()]
      .sort(([a], [b]) => a - b)
      .flatMap(([, car]) => [
        ...PLAN_SLOTS.flatMap((slot) => {
          const saved = car.slots.get(slot);
          return saved === undefined ? [] : [saved];
        }),
        ...(car.active === undefined ? [] : [car.active]),
      ]);
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
