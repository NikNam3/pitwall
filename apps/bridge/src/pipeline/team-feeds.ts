import type { BasisActive } from '@pitwall/contracts';
import { PLAN_SLOTS, type CarId, type FeedId, type GivenDecision, type SessionBasis, type Slot, type TeamId } from '@pitwall/domain';

/** What a feed reported last: its session uid, and its player car's team once Participants name it. */
type FeedSeat = { sessionUid: string; team: TeamId | null };

/** A plan decision as the bridge hands it to a feed's engine (C76). */
export type PlanDecision = Extract<GivenDecision, { kind: 'planCommitted' | 'planCleared' | 'planSaved' | 'planRemoved' }>;

/** What a car's plan decisions leave for a feed that joins later (C76): its saved slots and its active plan. */
type CarPlans = { slots: Map<Slot, Extract<PlanDecision, { kind: 'planSaved' }>>; active: Extract<PlanDecision, { kind: 'planCommitted' | 'planCleared' }> | undefined };

/** The key of one team in one session. */
const teamKey = (seat: { sessionUid: string; team: TeamId }): string => `${seat.sessionUid}:${seat.team}`;

/** The plan `basis.active` shows (C62d): a saved plan's id, name and laps; `null`: none. */
type ShownPlan = BasisActive['plan'];

/**
 * What takes a feed's plan decisions: its running session (`FeedPipeline.commitPlan`), and the plan choice that goes
 * with them (`showPlan`, the plan as committed: a later edit of the saved plan changes nothing of it, R22), for
 * `basis.active` (C62d).
 */
export type PlanSink = {
  commitPlan(decision: PlanDecision): unknown;
  showPlan?(plan: ShownPlan): void;
};

/**
 * The team's feeds (C1a): the feeds of one session uid whose player cars have the same team (Participants). Bookkeeping
 * of the bridge's feeds, no judgement (C43). Each `FeedPipeline` given it (option `teams`) connects itself as its feed's
 * plan sink and tells it its session uid and its player car's team as they change.
 */
export class TeamFeeds {
  readonly #seats = new Map<FeedId, FeedSeat>();
  /** Per feed, its newest pipeline: the one a plan decision for the feed goes to. */
  readonly #sinks = new Map<FeedId, PlanSink>();
  /** The teams of a session whose race-start commit was claimed (C62d, C76): once per session uid and team. */
  readonly #raceStarts = new Set<string>();

  /** Feed `feedId`'s plan decisions go to `sink` from now on (a newer pipeline of the feed replaces the older). */
  connect(feedId: FeedId, sink: PlanSink): void {
    this.#sinks.set(feedId, sink);
  }

  /**
   * Feed `feedId` reached its race's first frame with its team known: `true` for the first feed of its team in its
   * session (it commits the prepared plans, C62d), `false` for every later one and for a feed without a team.
   */
  claimRaceStart(feedId: FeedId): boolean {
    const seat = this.#seats.get(feedId);
    if (seat === undefined || seat.team === null) return false;
    const key = teamKey({ sessionUid: seat.sessionUid, team: seat.team });
    if (this.#raceStarts.has(key)) return false;
    this.#raceStarts.add(key);
    return true;
  }

  /**
   * `decisions`, in order, to every feed of `feedId`'s team then running (each its own engine's current frame and
   * decisions sidecar, C76), each kept for a feed that joins later.
   */
  commitToTeam(feedId: FeedId, decisions: readonly PlanDecision[]): void {
    for (const id of this.teamOf(feedId)) {
      const sink = this.#sinks.get(id);
      for (const decision of decisions) sink?.commitPlan(decision);
    }
    for (const decision of decisions) this.notePlan(feedId, decision);
  }
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

  /** Per team of a session, its newest plan choice (C1a, C62d): what a feed joining the team later shows. */
  readonly #shown = new Map<string, ShownPlan>();

  /**
   * A plan chosen for feed `feedId`'s team (the race-start commit's plan, a `basis.choose` with a plan; `null`: none):
   * every feed of the team then running shows it, and it is kept for a feed that joins later. Called with the choice's
   * plan decisions (`commitToTeam`), so each feed records it where they reached it.
   */
  showToTeam(feedId: FeedId, plan: ShownPlan): void {
    for (const id of this.teamOf(feedId)) this.#sinks.get(id)?.showPlan?.(plan);
    const seat = this.#seats.get(feedId);
    if (seat !== undefined && seat.team !== null) this.#shown.set(teamKey({ sessionUid: seat.sessionUid, team: seat.team }), plan);
  }

  /** The newest plan chosen for feed `feedId`'s team in its session; `undefined` while its team is not known or none was chosen. */
  shownOf(feedId: FeedId): ShownPlan | undefined {
    const seat = this.#seats.get(feedId);
    if (seat === undefined || seat.team === null) return undefined;
    return this.#shown.get(teamKey({ sessionUid: seat.sessionUid, team: seat.team }));
  }

  /** Per team of a session, its newest basis choice (C1a, C62): what a feed joining the team later is handed. */
  readonly #bases = new Map<string, SessionBasis>();

  /** A basis chosen for feed `feedId`'s team, kept as its newest. A feed without a team keeps none. */
  noteBasis(feedId: FeedId, basis: SessionBasis): void {
    const seat = this.#seats.get(feedId);
    if (seat === undefined || seat.team === null) return;
    this.#bases.set(teamKey({ sessionUid: seat.sessionUid, team: seat.team }), basis);
  }

  /** The newest basis chosen for feed `feedId`'s team in its session; none while its team is not known or none was chosen. */
  basisOf(feedId: FeedId): SessionBasis | undefined {
    const seat = this.#seats.get(feedId);
    if (seat === undefined || seat.team === null) return undefined;
    return this.#bases.get(teamKey({ sessionUid: seat.sessionUid, team: seat.team }));
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
