// Choosing a saved plan in a race (C1a, C62, C62d, C76; SP4.3e spec §4.3 "Choosing a plan in a race"): a saved plan is a
// template of plan decisions. Its cars go by race number (C62: the same car across sessions) to the race's car slots
// that carry them; per car its slots are saved, the slots the car holds now that the plan lacks are removed, and its
// active slot is committed. "None" commits nothing. Pure bookkeeping, no judgement (C43): whether a plan can still be
// followed is `strategy`'s.
import { PLAN_SLOTS, planSlots, type CarId, type DecisionRecord, type SavedPlan, type TeamId, type TrackId } from '@pitwall/domain';
import type { ActionOutcome } from '@pitwall/contracts';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { shownPlanOf, type ShownPlan } from '../pipeline/basis-sidecar.ts';
import type { PlanTarget } from '../pipeline/feed-pipeline.ts';
import type { LastChoiceStore, PlanChoice } from '../pipeline/last-choice-types.ts';
import type { PlanDecision } from '../pipeline/team-feeds.ts';
import type { SavedPlanStore } from './saved-plans.ts';

/** The decisions of a feed's projection, as the pipeline gives them (C28). */
type Decisions = readonly DeepReadonly<DecisionRecord>[];

/**
 * `plan` as the plan decisions a race commits: `cars` maps a race number to the race's car slot that carries it,
 * `current` is the feed's projected decisions. Per car of the plan whose race number the race carries: `planSaved` per
 * slot in `PLAN_SLOTS` order, then `planRemoved` per slot the car holds now that the plan lacks, then `planCommitted`
 * with the active slot. A race number the race does not carry is skipped.
 */
export function planDecisionsOf(plan: SavedPlan, cars: ReadonlyMap<number, CarId>, current: Decisions): PlanDecision[] {
  const history = { decisions: current as readonly DecisionRecord[] };
  return plan.cars.flatMap((prepared): PlanDecision[] => {
    const car = cars.get(prepared.raceNumber);
    if (car === undefined) return [];
    const held = planSlots(history, car);
    const saved = PLAN_SLOTS.flatMap((slot): PlanDecision[] => {
      const policy = prepared.slots[slot];
      return policy === undefined ? [] : [{ kind: 'planSaved', carId: car, slot, policy: structuredClone(policy) }];
    });
    const removed = PLAN_SLOTS.flatMap((slot): PlanDecision[] =>
      held[slot] !== undefined && prepared.slots[slot] === undefined ? [{ kind: 'planRemoved', carId: car, slot }] : []);
    const active = prepared.active === null ? undefined : prepared.slots[prepared.active];
    const committed: PlanDecision[] = active === undefined || prepared.active === null
      ? []
      : [{ kind: 'planCommitted', carId: car, policy: structuredClone(active), slot: prepared.active }];
    return [...saved, ...removed, ...committed];
  });
}

/** The feeds a plan choice commits to: per feed its running race (`undefined` without one) and the team's commit. */
export type PlanFeeds = {
  /** The feeds of the bridge. */
  feeds(): Iterable<{ feedId: string; target(): PlanTarget | undefined }>;
  /** `decisions` to every feed of `feedId`'s team then running, each kept for a feed that joins later (`TeamFeeds.commitToTeam`). */
  commitToTeam(feedId: string, decisions: readonly PlanDecision[]): void;
  /** The chosen plan (`null`: none) shown on every feed of `feedId`'s team then running, kept likewise (`TeamFeeds.showToTeam`). */
  showToTeam(feedId: string, plan: ShownPlan): void;
};

/** The team's last chosen or saved plan on the track (`LastChoice.plan`); `undefined` for none or a plan no longer saved. */
export function lastPlanOf(o: { lastChoice: Pick<LastChoiceStore, 'read'>; store: Pick<SavedPlanStore, 'read'> }, team: TeamId, trackId: TrackId): SavedPlan | undefined {
  const id = o.lastChoice.read(team, trackId)?.plan.id ?? null;
  if (id === null) return undefined;
  const plan = o.store.read(id);
  return plan !== undefined && plan.team === team && plan.trackId === trackId ? plan : undefined;
}

/**
 * The bridge's `PlanChoice` (C62d, C76): a plan chosen in a race commits its decisions (`planDecisionsOf`, read against
 * the first running feed's projection of the team on the track) on each of the team's feeds then running, and they show
 * it (`basis.active`); `null` commits nothing and they show none.
 */
export function createPlanChoice(o: { feeds: PlanFeeds; store: Pick<SavedPlanStore, 'read'> }): PlanChoice {
  /** The first running feed of the team's race on the track and its race; `undefined` without one. */
  const raceOf = (team: TeamId, trackId: TrackId): { feedId: string; target: PlanTarget } | undefined => {
    for (const feed of o.feeds.feeds()) {
      const target = feed.target();
      if (target !== undefined && target.team === team && target.trackId === trackId) return { feedId: feed.feedId, target };
    }
    return undefined;
  };
  return {
    choosePlan(team: TeamId, trackId: TrackId, planId: string | null): ActionOutcome {
      if (planId === null) {
        const race = raceOf(team, trackId);
        if (race !== undefined) o.feeds.showToTeam(race.feedId, null);
        return { ok: true };
      }
      const plan = o.store.read(planId);
      if (plan === undefined || plan.team !== team || plan.trackId !== trackId) return { ok: false, reason: 'invalid', message: `no saved plan ${planId} of team ${team} on track ${trackId}` };
      const race = raceOf(team, trackId);
      if (race === undefined) return { ok: false, reason: 'notSupported', message: `no race of team ${team} on track ${trackId} runs` };
      o.feeds.commitToTeam(race.feedId, planDecisionsOf(plan, race.target.cars, race.target.decisions));
      o.feeds.showToTeam(race.feedId, shownPlanOf(plan));
      return { ok: true };
    },
  };
}
