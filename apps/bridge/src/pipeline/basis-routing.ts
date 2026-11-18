// A basis choice across the team's feeds (C1a, C61, C62, C62d, C73, C76; SP4.3e spec §4.2). `basis.choose` of one feed
// is serialised per team, so two confirms close together end with the same newest decision on every feed. It makes the
// named sessions of each team feed's own seat current (`ensureCurrent`, priority `runningBasis`; the running sessions go
// on meanwhile), then commits `basisChosen` on each of the team's feeds running a session (each its own engine's next
// frame and decisions sidecar, each loading its own seat's sessions; one the seat never stored is missing, never an
// error), keeps it for a feed that joins later, records it as the team's last confirmed choice on the track, and then,
// unless the plan is kept (`undefined`), chooses the plan (`PlanChoice`). The choice names sessions, never their data.
import type { ActionOutcome, UiAction } from '@pitwall/contracts';
import type { FeedId, SessionBasis, TeamId, TrackId } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import type { SessionKey } from '../storage/db.ts';
import type { RebuildService } from '../storage/rebuild-service-types.ts';
import type { FeedPipeline } from './feed-pipeline.ts';
import type { LastChoiceStore, PlanChoice } from './last-choice-types.ts';
import type { TeamFeeds } from './team-feeds.ts';

/** The basis uiActions as the bridge takes them. */
export type BasisAction = Extract<UiAction, { kind: 'basis.choose' }>;

/** Whether `action` is one of the basis uiActions. */
export const isBasisAction = (action: UiAction): action is BasisAction => action.kind === 'basis.choose';

/** The pipeline's part the routing uses. */
type BasisFeed = Pick<FeedPipeline, 'commitBasis' | 'basisKeys' | 'basisRebuilding' | 'runningTrackId'>;

export type BasisRoutingOptions = {
  teams: TeamFeeds;
  /** The bridge's pipelines by feed (`serve`'s map): the newest one of each feed. */
  pipelines: ReadonlyMap<FeedId, BasisFeed>;
  rebuild: Pick<RebuildService, 'ensureCurrent'>;
  plans: PlanChoice;
  /** The team's last confirmed choices (C62): a confirmed choice is written there; without it none is kept. */
  lastChoice?: Pick<LastChoiceStore, 'read' | 'write'>;
  /** When a choice is confirmed (the last choice's time). Default `Date.now`. */
  now?: () => number;
  log?: Pick<Logger, 'error' | 'warn'>;
};

const keyText = (k: SessionKey): string => `${k.sessionUid}/${k.weekendId}/${k.playerCar}`;

export class BasisRouting {
  readonly #o: BasisRoutingOptions;
  /** Per team (or per feed, while its team is not known), the choice under way: the next one waits for it. */
  readonly #turns = new Map<string, Promise<unknown>>();

  constructor(opts: BasisRoutingOptions) {
    this.#o = opts;
  }

  /** Takes `basis.choose`; answers once the choice is committed on the team's feeds, or why not (C73). */
  choose(action: BasisAction): Promise<ActionOutcome> {
    if (!this.#o.pipelines.has(action.feedId)) return Promise.resolve({ ok: false, reason: 'invalid', message: `no feed ${action.feedId}` });
    const team = this.#o.teams.team(action.feedId);
    const key = team === null ? `feed:${action.feedId}` : `team:${team}`;
    const turn = (this.#turns.get(key) ?? Promise.resolve()).then(() => this.#choose(action));
    this.#turns.set(key, turn.catch(() => {}));
    return turn;
  }

  async #choose(action: BasisAction): Promise<ActionOutcome> {
    const { teams, pipelines, rebuild, plans } = this.#o;
    const own = pipelines.get(action.feedId);
    const trackId = own?.runningTrackId();
    if (own === undefined || trackId === undefined) return { ok: false, reason: 'notSupported', message: 'this feed runs no session' };
    const running = (): BasisFeed[] =>
      teams.teamOf(action.feedId).flatMap((id) => {
        const feed = pipelines.get(id);
        return feed !== undefined && feed.runningTrackId() !== undefined ? [feed] : [];
      });
    // The sessions of each feed's own seat, made current first: a basis enters only with every named session current (C61).
    const keys = new Map<string, SessionKey>();
    for (const feed of running()) for (const k of feed.basisKeys(action.basis)) keys.set(keyText(k), k);
    if (keys.size > 0) {
      const progress = (done: number, total: number): void => {
        for (const feed of running()) feed.basisRebuilding({ done, total });
      };
      try {
        await rebuild.ensureCurrent([...keys.values()], { priority: 'runningBasis', onProgress: progress });
      } catch (error) {
        this.#o.log?.error({ feedId: action.feedId, err: error }, 'the chosen basis was not made current');
        return { ok: false, reason: 'notSupported', message: 'the chosen sessions could not be made current' };
      } finally {
        for (const feed of running()) feed.basisRebuilding(null);
      }
    }
    for (const feed of running()) {
      const result = feed.commitBasis(action.basis);
      if (!result.ok) this.#o.log?.warn({ feedId: action.feedId, reason: result.reason, message: result.message }, 'a team feed did not take the basis');
    }
    teams.noteBasis(action.feedId, action.basis);
    const team = teams.team(action.feedId);
    if (team !== null) this.#remember(team, trackId as TrackId, action);
    if (action.plan === undefined || team === null) return { ok: true };
    return plans.choosePlan(team, trackId as TrackId, action.plan);
  }

  /** The team's last confirmed choice on the track (C62): the basis per kind and, unless kept, the plan. */
  #remember(team: TeamId, trackId: TrackId, action: BasisAction): void {
    const store = this.#o.lastChoice;
    if (store === undefined) return;
    try {
      const at = new Date((this.#o.now ?? Date.now)()).toISOString();
      const basis: SessionBasis = action.basis;
      const previous = store.read(team, trackId);
      store.write(team, {
        trackId,
        basis: { practice: { refs: [...basis.practice], at }, qualifying: { ref: basis.qualifying, at } },
        plan: action.plan === undefined ? (previous?.plan ?? { id: null, at }) : { id: action.plan, at },
      });
    } catch (error) {
      this.#o.log?.error({ feedId: action.feedId, err: error }, 'the last choice was not written');
    }
  }
}
