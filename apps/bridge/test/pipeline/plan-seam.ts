// The seam SP4.3b Task 17 adds to the bridge, for its tests (C1a, C73, C76; spec §8.2, §8.5). Loaded through a dynamic
// import so the tests compile before the module exists.
//
// `src/pipeline/plan-routing.ts` exports `PlanRouting`: `new PlanRouting({ teams, pipelines })` over the bridge's
// `TeamFeeds` (Task 2b, also given to every pipeline as its option `teams`) and `serve`'s map of pipelines by feed (it
// may be filled after the routing is built). `commit(action)` takes a decoded `plan.commit` or `plan.clear` of feed
// `action.feedId` and answers as every uiAction (C73):
//  - it checks the range the decoder cannot: every stop lap (and every `degradationOff` switch lap) within 1…the race's
//    laps (`totalLaps` of `action.feedId`'s running session); else `{ ok: false, reason: 'invalid', message }` and
//    nothing is stored or handed on. Whether the plan can still be followed is `strategy`'s judgement (C43);
//  - it hands `planCommitted { carId, policy }` (the policy whole) or `planCleared { carId }` to the running session of
//    every feed in `teams.teamOf(action.feedId)`, each with its own next frame, and writes it, with that session's record
//    index, to each one's decisions sidecar (`<file>.decisions.json`);
//  - a feed that joins the team later (its team known after the commit) is handed each car's newest plan decision of the
//    team at its first frame with its team known, and writes it to its own sidecar.
// A replay feeds the plan decisions of a recording's decisions sidecar back at their record index, as it does
// `calibrationChosen` (`recordingDecisions`, `FeedPipelineOptions.recorded`).
import type { CarId, FeedId, Policy } from '@pitwall/domain';
import type { DecisionResult, FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import type { TeamFeeds } from '../../src/pipeline/team-feeds.ts';

/**
 * The plan uiActions as the bridge takes them: `feedId` is the feed the user commits from (requested in
 * `packages/contracts/src/ui/types.ts`, as `calibration.choose` names its feed).
 */
export type PlanAction =
  | { kind: 'plan.commit'; feedId: FeedId; carId: CarId; policy: Policy }
  | { kind: 'plan.clear'; feedId: FeedId; carId: CarId };

export type PlanRouting = { commit(action: PlanAction): DecisionResult };
type PlanRoutingClass = new (o: { teams: TeamFeeds; pipelines: ReadonlyMap<FeedId, FeedPipeline> }) => PlanRouting;

const MODULE = new URL('../../src/pipeline/plan-routing.ts', import.meta.url).pathname;

/** `PlanRouting` from its module. */
export async function planRoutingClass(): Promise<PlanRoutingClass> {
  const mod = (await import(/* @vite-ignore */ MODULE)) as { PlanRouting?: PlanRoutingClass };
  if (mod.PlanRouting === undefined) throw new Error('plan-routing.ts exports no PlanRouting');
  return mod.PlanRouting;
}
