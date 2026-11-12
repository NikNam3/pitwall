// The plan decision across the team's feeds (C1a, C73, C76; SP4.3b spec §8.2, §8.5). A plan committed or cleared from
// one feed goes to every feed of its team (`TeamFeeds.teamOf`), each with its own engine's next frame and into its own
// decisions sidecar, so each recording replays alone; `teams` keeps each car's newest one for a feed that joins later.
// It checks only the range the decoder cannot (C73): the stop laps within the race's laps. Whether the plan can still be
// followed is `strategy`'s judgement (C43). Every other decision stays with its feed.
import type { CarId, FeedId, Policy } from '@pitwall/domain';
import type { UiAction } from '@pitwall/contracts';
import type { DecisionResult, FeedPipeline } from './feed-pipeline.ts';
import type { PlanDecision, TeamFeeds } from './team-feeds.ts';

/** The plan uiActions as the bridge takes them. */
export type PlanAction = Extract<UiAction, { kind: 'plan.commit' | 'plan.clear' }>;

/** The pipeline's part the routing uses. */
type PlanFeed = Pick<FeedPipeline, 'commitPlan' | 'totalLaps'>;

/** Whether `action` is one of the plan uiActions. */
export const isPlanAction = (action: UiAction): action is PlanAction => action.kind === 'plan.commit' || action.kind === 'plan.clear';

/** The first lap of `policy` (a stop or a `degradationOff` switch) past `totalLaps`, if any. */
function lapPastRace(policy: Policy, totalLaps: number): number | undefined {
  const laps = [
    ...policy.stops.map((stop) => stop.lap),
    ...policy.triggers.flatMap((trigger) => (trigger.kind === 'degradationOff' ? trigger.action.switchTo.map((stop) => stop.lap) : [])),
  ];
  return laps.find((lap) => lap > totalLaps);
}

export class PlanRouting {
  readonly #teams: TeamFeeds;
  readonly #pipelines: ReadonlyMap<FeedId, PlanFeed>;

  /** `pipelines`: `serve`'s map of pipelines by feed; it may be filled after the routing is built. */
  constructor(o: { teams: TeamFeeds; pipelines: ReadonlyMap<FeedId, PlanFeed> }) {
    this.#teams = o.teams;
    this.#pipelines = o.pipelines;
  }

  /**
   * Commits `action` from feed `action.feedId` to every feed of its team; rejects (and hands on nothing) a stop past the
   * race's laps, an unknown feed, or a feed without a running session.
   */
  commit(action: PlanAction): DecisionResult {
    const own = this.#pipelines.get(action.feedId);
    if (own === undefined) return { ok: false, reason: 'invalid', message: `no feed ${action.feedId}` };
    const totalLaps = own.totalLaps();
    if (totalLaps === undefined) return { ok: false, reason: 'notSupported', message: `feed ${action.feedId} runs no session` };
    if (action.kind === 'plan.commit') {
      const past = lapPastRace(action.policy, totalLaps);
      if (past !== undefined) return { ok: false, reason: 'invalid', message: `lap ${past} is past the race's ${totalLaps} laps` };
    }
    const decision = planDecision(action.carId, action);
    const answer = own.commitPlan(decision);
    if (!answer.ok) return answer;
    for (const id of this.#teams.teamOf(action.feedId)) {
      if (id !== action.feedId) this.#pipelines.get(id)?.commitPlan(decision);
    }
    this.#teams.notePlan(action.feedId, decision);
    return answer;
  }
}

/** The decision a plan action commits: the policy whole (spec §8.2). */
const planDecision = (carId: CarId, action: PlanAction): PlanDecision =>
  action.kind === 'plan.commit' ? { kind: 'planCommitted', carId, policy: action.policy } : { kind: 'planCleared', carId };
