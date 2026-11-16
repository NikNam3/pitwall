// The plan decisions across the team's feeds (C1a, C27a, C73, C76; SP4.3b spec §8.2, §8.5; SP4.3d spec §6.1). A plan
// action from one feed goes to every feed of its team (`TeamFeeds.teamOf`), each with its own engine's next frame and
// into its own decisions sidecar, so each recording replays alone; `teams` keeps per car the newest decision per slot and
// the active plan for a feed that joins later. `plan.activate` reads the slot's policy by `planSlots` over the committing
// feed's projection, never from the bridge's memory, so a `planSaved` a flashback voided is never activated (C27a). It
// checks only the ranges (C73): the stop laps within the race's laps, compounds and slots from their closed lists, an
// activated slot saved, a removed slot not the active one. Whether the plan can still be followed is `strategy`'s
// judgement (C43). Every other decision stays with its feed.
import { activeSlot, NOISE_COMPOUNDS, PLAN_SLOTS, planSlots, type DecisionRecord, type FeedId, type Policy } from '@pitwall/domain';
import type { UiAction } from '@pitwall/contracts';
import type { DecisionResult, FeedPipeline } from './feed-pipeline.ts';
import type { PlanDecision, TeamFeeds } from './team-feeds.ts';

/** The plan uiActions as the bridge takes them. */
export type PlanAction = Extract<UiAction, { kind: 'plan.commit' | 'plan.clear' | 'plan.save' | 'plan.remove' | 'plan.activate' }>;

/** The pipeline's part the routing uses. */
type PlanFeed = Pick<FeedPipeline, 'commitPlan' | 'totalLaps' | 'planDecisions'>;

const PLAN_KINDS: ReadonlySet<UiAction['kind']> = new Set(['plan.commit', 'plan.clear', 'plan.save', 'plan.remove', 'plan.activate']);

/** Whether `action` is one of the plan uiActions. */
export const isPlanAction = (action: UiAction): action is PlanAction => PLAN_KINDS.has(action.kind);

type Decisions = NonNullable<ReturnType<PlanFeed['planDecisions']>>;

/** Why `policy` is out of range for a race of `totalLaps` laps (C73), if it is. */
function policyOutOfRange(policy: Policy, totalLaps: number): string | undefined {
  const compounds: readonly string[] = NOISE_COMPOUNDS;
  if (policy.startCompound !== undefined && !compounds.includes(policy.startCompound)) return `unknown compound ${policy.startCompound}`;
  for (const stop of policy.stops) {
    if (!compounds.includes(stop.compound)) return `unknown compound ${stop.compound}`;
    if (stop.lap > totalLaps) return `lap ${stop.lap} is past the race's ${totalLaps} laps`;
  }
  return undefined;
}

/** The decision `action` commits, read against the committing feed's projected `decisions`; or why it is invalid (C73). */
function planDecision(action: PlanAction, decisions: Decisions, totalLaps: number): PlanDecision | string {
  const { carId } = action;
  if ('slot' in action && !(PLAN_SLOTS as readonly string[]).includes(action.slot)) return `unknown slot ${action.slot}`;
  if ('policy' in action) {
    const why = policyOutOfRange(action.policy, totalLaps);
    if (why !== undefined) return why;
  }
  // the decisions are facts, never changed (C24): read as the plain records they are
  const history = { decisions: decisions as readonly DecisionRecord[] };
  switch (action.kind) {
    case 'plan.commit':
      return { kind: 'planCommitted', carId, policy: action.policy };
    case 'plan.clear':
      return { kind: 'planCleared', carId };
    case 'plan.save':
      return { kind: 'planSaved', carId, slot: action.slot, policy: action.policy };
    case 'plan.remove':
      return activeSlot(history, carId) === action.slot
        ? `slot ${action.slot} is the active plan: activate another or clear the plan first`
        : { kind: 'planRemoved', carId, slot: action.slot };
    case 'plan.activate': {
      const policy = planSlots(history, carId)[action.slot];
      return policy === undefined ? `slot ${action.slot} is empty` : { kind: 'planCommitted', carId, policy: structuredClone(policy), slot: action.slot };
    }
  }
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
   * Commits `action` from feed `action.feedId` to every feed of its team; rejects (and hands on nothing) a value out of
   * range (C73), an unknown feed, or a feed without a running session.
   */
  commit(action: PlanAction): DecisionResult {
    const own = this.#pipelines.get(action.feedId);
    if (own === undefined) return { ok: false, reason: 'invalid', message: `no feed ${action.feedId}` };
    const totalLaps = own.totalLaps();
    const decisions = own.planDecisions();
    if (totalLaps === undefined || decisions === undefined) return { ok: false, reason: 'notSupported', message: `feed ${action.feedId} runs no session` };
    const decision = planDecision(action, decisions, totalLaps);
    if (typeof decision === 'string') return { ok: false, reason: 'invalid', message: decision };
    const answer = own.commitPlan(decision);
    if (!answer.ok) return answer;
    for (const id of this.#teams.teamOf(action.feedId)) {
      if (id !== action.feedId) this.#pipelines.get(id)?.commitPlan(decision);
    }
    this.#teams.notePlan(action.feedId, decision);
    return answer;
  }
}
