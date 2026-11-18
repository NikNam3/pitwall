// The bridge's planning module (C1a, C62, C62d, C73, C76; SP4.3e spec §4.3): the feed pipelines' planning hooks and the
// `plans.*` uiActions, over the planning runner (`runner.ts`). At a qualifying's live end (`endsQualifying`) it opens the
// feed's round with that qualifying, its own basis's practice and the race assumptions `{ laps: suggested, sets:
// 'carried' }` (laps unknown without a suggestion, C3); the feed's next session start closes it. At a live race's start
// it hands the pipeline the team's last chosen or saved plan on the track as plan decisions (`planDecisionsOf`).
import type { ActionOutcome, UiAction } from '@pitwall/contracts';
import { endsQualifying, raceFormatOf, type CarKey, type FeedId, type Known, type RaceFormat, type SessionRef, type TrackId } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import type { EndedSession, PlanningHooks, PlanTarget, RaceStartPlan } from '../pipeline/feed-pipeline.ts';
import type { LastChoiceStore } from '../pipeline/last-choice-types.ts';
import type { FeedSeatStore, RememberedSeat } from './feed-seats.ts';
import { lastPlanOf, planDecisionsOf } from './plan-choice.ts';
import { MAX_RACE_LAPS, type PlanningRunner, type PrepareAction } from './runner.ts';
import type { SavedPlanStore } from './saved-plans.ts';

/** The planning uiActions (C73): the round's slots, its race assumptions, opening it, and the saved plans. */
export type PlanningAction = PrepareAction | Extract<UiAction, { kind: 'plans.round.open' | 'plans.race.set' | 'plans.save' | 'plans.rename' | 'plans.delete' }>;

const PLANNING_KINDS: ReadonlySet<UiAction['kind']> = new Set(['plans.round.open', 'plans.race.set', 'plans.save', 'plans.rename', 'plans.delete']);

export const isPlanningAction = (action: UiAction): action is PlanningAction => action.kind.startsWith('plans.prepare.') || PLANNING_KINDS.has(action.kind);

export type PlanningOptions = {
  /** The runner; built with `seatOf` = this module's `seatOf`. */
  runner: PlanningRunner;
  store: Pick<SavedPlanStore, 'read'>;
  lastChoice: Pick<LastChoiceStore, 'read' | 'write'>;
  /** The race laps to suggest for a race of `format` on `trackId` (`suggestedLapsOf` over the stored sessions). */
  suggestedLaps: (trackId: TrackId, format: RaceFormat) => Known<number>;
  /** The feeds' remembered seats (R19); unset: none is remembered. */
  seats?: FeedSeatStore;
  log: Pick<Logger, 'warn' | 'error'>;
  /** The time a basis is confirmed at (ISO). Default: now. */
  now?: () => string;
};

const invalid = (message: string): ActionOutcome => ({ ok: false, reason: 'invalid', message });

/** A remembered seat as the module keeps it: the seat and its track. */
type Remembered = Pick<RememberedSeat, 'seat' | 'trackId'>;

export class Planning implements PlanningHooks {
  readonly #o: PlanningOptions;
  /** Per feed the seat of its newest session that named one in this run (its player car's team and race number, C62). */
  readonly #seats = new Map<FeedId, CarKey>();
  /** Per feed its remembered seat as read once from `seats` (R19); `null`: none. */
  readonly #remembered = new Map<FeedId, Remembered | null>();
  /** Per feed the sessions started so far: a round waiting for its qualifying's file opens only if none started since. */
  readonly #starts = new Map<FeedId, number>();

  constructor(opts: PlanningOptions) {
    this.#o = opts;
  }

  /** The feed's remembered seat (read once; a missing or corrupt file: `undefined`, C3). */
  #rememberedOf(feedId: FeedId): Remembered | undefined {
    if (!this.#remembered.has(feedId)) this.#remembered.set(feedId, this.#o.seats?.read(feedId) ?? null);
    return this.#remembered.get(feedId) ?? undefined;
  }

  /** The feed's seat: its running (or newest) session's in this run, else the remembered one (R19; `undefined` without either). */
  seatOf(feedId: FeedId): CarKey | undefined {
    return this.#seats.get(feedId) ?? this.#rememberedOf(feedId)?.seat;
  }

  /** Feed `feedId` runs a session again (or its pipeline was made anew): its round closes, its job is cancelled. */
  sessionStarted(feedId: FeedId, trackId?: TrackId): void {
    this.#starts.set(feedId, (this.#starts.get(feedId) ?? 0) + 1);
    this.#o.runner.close(feedId);
    // Before any session of the feed: the closed state lists the saved plans on the remembered seat's track (R19).
    this.#o.runner.publishClosed(feedId, trackId ?? this.#rememberedOf(feedId)?.trackId);
  }

  /**
   * The running session's team became known (its seat, on `trackId`): the feed's seat now, remembered for the next
   * bridge start (R19); the closed state is published again for the seat's team.
   */
  seatKnown(feedId: FeedId, seat: CarKey, trackId: TrackId): void {
    this.#seats.set(feedId, { teamId: seat.teamId, raceNumber: seat.raceNumber });
    const remembered = this.#rememberedOf(feedId);
    if (remembered?.seat.teamId !== seat.teamId || remembered.seat.raceNumber !== seat.raceNumber || remembered.trackId !== trackId) {
      this.#remembered.set(feedId, { seat: { ...seat }, trackId });
      try {
        this.#o.seats?.write(feedId, seat, trackId);
      } catch (error) {
        this.#o.log.error({ feedId, err: error }, 'feed seat not remembered');
      }
    }
    if (!this.#o.runner.isOpen(feedId)) this.#o.runner.publishClosed(feedId, trackId);
  }

  /** Feed `feedId`'s session ended: a round opens when it ends qualifying (C62d), once its recording is closed. */
  sessionEnded(feedId: FeedId, ended: EndedSession): void {
    if (ended.seat !== undefined) this.#seats.set(feedId, ended.seat);
    const { phase } = ended;
    if (phase.kind !== 'qualifying' || !endsQualifying(phase)) return;
    const suggested = this.#o.suggestedLaps(ended.trackId, raceFormatOf(phase.format));
    const spec = {
      feedId,
      qualifying: { sessionUid: ended.key.sessionUid, weekendId: ended.key.weekendId },
      practice: ended.basis?.practice ?? [],
      race: { laps: suggested.known ? suggested.value : null, sets: 'carried' as const },
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
   * The user confirmed a round's basis (R23; C62, C62d, C70): the team's last choice on the track takes its practice
   * and qualifying, confirmed now, the plan part unchanged (`{ id: null }` without one). The track is the qualifying's
   * stored row's, else the remembered seat's; without a team or a track nothing is written. Written whether or not the
   * round's replay runs or succeeds.
   */
  #confirmBasis(feedId: FeedId, qualifying: SessionRef, practice: readonly SessionRef[]): void {
    const team = this.seatOf(feedId)?.teamId;
    const trackId = this.#o.runner.trackOf(feedId, qualifying) ?? this.#rememberedOf(feedId)?.trackId;
    if (team === undefined || trackId === undefined) return;
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
      case 'plans.round.open':
        this.#confirmBasis(action.feedId, action.qualifying, action.practice);
        void runner.open({ feedId: action.feedId, qualifying: action.qualifying, practice: action.practice, race: { laps: runner.laps(action.feedId) ?? null, sets: 'fresh' } })
          .catch((error: unknown) => this.#o.log.error({ feedId: action.feedId, err: error }, 'planning round not opened'));
        return { ok: true };
      case 'plans.race.set':
        if (!runner.isOpen(action.feedId)) return { ok: false, reason: 'notSupported' };
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
