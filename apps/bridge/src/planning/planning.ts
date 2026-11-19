// The bridge's planning module (C1a, C62, C62d, C73, C76; SP4.3e spec §4.3, SP4.3f spec §4.0, §4.2): the feed pipelines'
// planning hooks and the `plans.*` uiActions, over the planning runner (`runner.ts`). A round is a function of the picks
// (`plans.round.open`: a qualifying, the team it is stored for, a practice basis of that team, the race assumptions):
// the picks are checked first (C73), then the round opens, with the defaults when no race is given (the suggested laps,
// `carried`, `IMPORTED`; laps unknown without a suggestion, C3) or, reopening the feed's last round's qualifying, that
// round's race. Case A is case B with preselected picks: at a qualifying's live end (`endsQualifying`) the round opens
// with the ended session's team, that qualifying, its own basis's practice and the defaults; the feed's next session
// start closes it. At a live race's start it hands the pipeline the team's last chosen or saved plan on the track as
// plan decisions (`planDecisionsOf`).
import { decodeUiAction, type ActionOutcome, type UiAction } from '@pitwall/contracts';
import { endsQualifying, IMPORTED, raceFormatOf, type CarKey, type FeedId, type Known, type RaceFormat, type RoundRace, type SessionRef, type TeamId, type TrackId } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import type { EndedSession, PlanningHooks, PlanTarget, RaceStartPlan } from '../pipeline/feed-pipeline.ts';
import type { LastChoiceStore } from '../pipeline/last-choice-types.ts';
import { lastPlanOf, planDecisionsOf } from './plan-choice.ts';
import { MAX_RACE_LAPS, type PlanningRunner, type PrepareAction, type RaceDefaults } from './runner.ts';
import type { SavedPlanStore } from './saved-plans.ts';

/** The planning uiActions (C73): the round's slots, its race assumptions, opening it, and the saved plans. */
export type PlanningAction = PrepareAction | Extract<UiAction, { kind: 'plans.round.open' | 'plans.race.set' | 'plans.save' | 'plans.rename' | 'plans.delete' }>;

const PLANNING_KINDS: ReadonlySet<UiAction['kind']> = new Set(['plans.round.open', 'plans.race.set', 'plans.save', 'plans.rename', 'plans.delete']);

export const isPlanningAction = (action: UiAction): action is PlanningAction => action.kind.startsWith('plans.prepare.') || PLANNING_KINDS.has(action.kind);

export type PlanningOptions = {
  runner: PlanningRunner;
  store: Pick<SavedPlanStore, 'read'>;
  lastChoice: Pick<LastChoiceStore, 'read' | 'write'>;
  /** The race laps to suggest for a race of `format` on `trackId` (`suggestedLapsOf` over the stored sessions). */
  suggestedLaps: (trackId: TrackId, format: RaceFormat) => Known<number>;
  log: Pick<Logger, 'warn' | 'error'>;
  /** The time a basis is confirmed at (ISO). Default: now. */
  now?: () => string;
};

const invalid = (message: string): ActionOutcome => ({ ok: false, reason: 'invalid', message });

export class Planning implements PlanningHooks {
  readonly #o: PlanningOptions;
  /** Per feed the sessions started so far: a round waiting for its qualifying's file opens only if none started since. */
  readonly #starts = new Map<FeedId, number>();
  /** The race assumptions a round opened without any starts from (spec §4.4): the suggested laps, `carried`, `IMPORTED`. */
  readonly #defaults: RaceDefaults;

  constructor(opts: PlanningOptions) {
    this.#o = opts;
    this.#defaults = (trackId, format) => {
      const suggested = opts.suggestedLaps(trackId, format);
      return { laps: suggested.known ? suggested.value : null, sets: 'carried', conditions: IMPORTED };
    };
  }

  /** Feed `feedId` runs a session again (or its pipeline was made anew): its round closes, its job is cancelled. */
  sessionStarted(feedId: FeedId, trackId?: TrackId): void {
    this.#starts.set(feedId, (this.#starts.get(feedId) ?? 0) + 1);
    this.#o.runner.close(feedId);
    this.#o.runner.publishClosed(feedId, trackId);
  }

  /**
   * The running session's team became known (its seat, on `trackId`): while no round is open the feed's closed state
   * lists that team's saved plans on the track (C62d: a race chooses among them). Kept in memory only, for this run.
   */
  seatKnown(feedId: FeedId, seat: CarKey, trackId: TrackId): void {
    if (!this.#o.runner.isOpen(feedId)) this.#o.runner.publishClosed(feedId, trackId, seat.teamId);
  }

  /**
   * Feed `feedId`'s session ended: a round opens when it ends qualifying (C62d), once its recording is closed, with the
   * session's team, its ref, its basis's practice and the defaults; without a known seat none opens (logged).
   */
  sessionEnded(feedId: FeedId, ended: EndedSession): void {
    const { phase } = ended;
    if (phase.kind !== 'qualifying' || !endsQualifying(phase)) return;
    if (ended.seat === undefined) {
      this.#o.log.warn({ feedId, sessionUid: ended.key.sessionUid }, 'planning round not opened: the qualifying\'s team is not known');
      return;
    }
    const spec = {
      feedId,
      qualifying: { sessionUid: ended.key.sessionUid, weekendId: ended.key.weekendId },
      team: ended.seat.teamId,
      practice: ended.basis?.practice ?? [],
      race: this.#defaults(ended.trackId as TrackId, raceFormatOf(phase.format)),
    };
    const starts = this.#starts.get(feedId) ?? 0;
    void ended.closed
      .then(() => ((this.#starts.get(feedId) ?? 0) === starts ? this.#o.runner.open(spec) : undefined))
      .catch((error: unknown) => this.#o.log.error({ feedId, err: error }, 'planning round not opened'));
  }

  /**
   * A live race's first frame with its team known, on the team's first feed (C62d, C76): the team's last chosen or saved
   * plan on the track (`undefined` for "none") with the plan decisions the team's feeds commit (none for "none").
   */
  raceStarted(race: PlanTarget): RaceStartPlan {
    const plan = lastPlanOf(this.#o, race.team, race.trackId);
    return { plan, decisions: plan === undefined ? [] : planDecisionsOf(plan, race.cars, race.decisions) };
  }

  /**
   * The user confirmed a round's basis (R23; C62, C62d, C70): the team's last choice on the qualifying's track takes its
   * practice and qualifying, confirmed now, the plan part unchanged (`{ id: null }` without one). Written whether or not
   * the round's replay runs or succeeds.
   */
  #confirmBasis(feedId: FeedId, team: TeamId, trackId: TrackId, qualifying: SessionRef, practice: readonly SessionRef[]): void {
    const at = (this.#o.now ?? (() => new Date().toISOString()))();
    try {
      const last = this.#o.lastChoice.read(team, trackId);
      this.#o.lastChoice.write(team, {
        trackId,
        basis: {
          practice: { refs: practice.map(({ sessionUid, weekendId }) => ({ sessionUid, weekendId })), at },
          qualifying: { ref: { sessionUid: qualifying.sessionUid, weekendId: qualifying.weekendId }, at },
        },
        plan: last?.plan ?? { id: null, at },
      });
    } catch (error) {
      this.#o.log.error({ feedId, err: error }, 'last choice not written');
    }
  }

  /** A planning uiAction (C73): checked against the feed's round (without one `notSupported`); a rejection changes nothing. */
  apply(action: PlanningAction): ActionOutcome {
    const { runner } = this.#o;
    switch (action.kind) {
      case 'plans.round.open': {
        // the shape (the conditions included) as the one uiAction decoder reads it, then the picks against storage
        if (decodeUiAction(action) === undefined) return invalid('the round\'s picks or race assumptions are malformed');
        const spec = { feedId: action.feedId, qualifying: action.qualifying, team: action.team, practice: action.practice, ...(action.race !== undefined && { race: action.race as RoundRace }) };
        const checked = runner.check(spec);
        if (!checked.ok) return checked;
        this.#confirmBasis(action.feedId, action.team, checked.trackId, action.qualifying, action.practice);
        void runner.open(spec, this.#defaults).catch((error: unknown) => this.#o.log.error({ feedId: action.feedId, err: error }, 'planning round not opened'));
        return { ok: true };
      }
      case 'plans.race.set':
        if (!runner.isOpen(action.feedId)) return { ok: false, reason: 'notSupported' };
        if (decodeUiAction(action) === undefined) return invalid('the race assumptions are malformed: laps from 1, conditions with rising offsets, a known weather and rain 0 to 100');
        if (action.race.laps > MAX_RACE_LAPS) return invalid(`the race's laps are 1 to ${MAX_RACE_LAPS}`);
        runner.setRace(action.feedId, action.race);
        return { ok: true };
      case 'plans.save':
        return runner.save(action.feedId, { ...(action.name !== undefined && { name: action.name }), ...(action.replaces !== undefined && { replaces: action.replaces }) });
      case 'plans.rename':
        return runner.rename(action.feedId, action.id, action.name);
      case 'plans.delete':
        return runner.delete(action.feedId, action.id);
      default:
        return runner.edit(action);
    }
  }

  /** Cancels every running planning job; no result is published afterwards. */
  close(): Promise<void> {
    return this.#o.runner.closeAll();
  }
}
