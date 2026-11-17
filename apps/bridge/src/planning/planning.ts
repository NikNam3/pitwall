// The bridge's planning module (SP4.3d spec §7.0 rules 3–6, §7.1, §7.4; C1a, C51, C54, C55, C62d, C70, C73): per feed
// its planning round (`round.ts`), the team's prepared plans (`store.ts`) changed only by the `plans.prepare.*`
// uiActions, and the planning job. It owns and publishes the core topics `plans.prepared` (the round and its prepared
// plans) and `plans.preview` (the job's result per our car, `Computed<StrategyCar>`; never stored, outside the
// determinism hash, C51). Every accepted action writes the file, republishes `plans.prepared` and re-runs the planning
// job of every open round of the team (C1a), on the ended qualifying's run as of its end with the entered laps
// (`asOfEnded`, `planningInputFrom`), through a `JobRunner` per round on the bridge's shared `WorkerLimit`; the newest
// run wins. Without entered laps no job runs.
import type { ActionOutcome, Computed, PlanningRound, UiAction } from '@pitwall/contracts';
import { type CarId, type FeedId, type Known, type PreparedCar, type PreparedPlans, type RaceFormat, type StrategyCar, type StrategyOutput } from '@pitwall/domain';
import { planningInputFrom, type StrategyInput } from '@pitwall/analysis';
import type { AsOfView, Job } from '@pitwall/engine/readers';
import { selectCar } from '../features/feature.ts';
import type { TopicHub } from '../hub/topic-hub.ts';
import { JobRunner, type ComputedFor, type JobResult } from '../jobs/job-runner.ts';
import type { WorkerLimit } from '../jobs/worker-limit.ts';
import type { Logger } from '../log.ts';
import type { EndedSession, PlanningHooks, RaceStart } from '../pipeline/feed-pipeline.ts';
import type { PlanDecision } from '../pipeline/team-feeds.ts';
import { raceStartDecisions } from './race-start.ts';
import { roundSeatOf, type RoundSeat } from './round.ts';
import { MAX_RACE_LAPS, type PreparedStore, type RaceKey } from './store.ts';

/** The planning round's uiActions (C73). */
export type PrepareAction = Extract<UiAction, { kind: `plans.prepare.${string}` }>;

export const isPrepareAction = (action: UiAction): action is PrepareAction => action.kind.startsWith('plans.prepare.');

export type PlanningOptions = {
  hub: TopicHub;
  store: PreparedStore;
  /** The planning job (`PLANNING_JOB`); its `prepare` is never called: its input is `planningInputFrom`'s. */
  job: Job<StrategyInput, StrategyOutput>;
  /** The bridge's one job-worker limit, shared with every feed's jobs (C1a, C51). */
  workerLimit: WorkerLimit;
  /** Feed `feedId`'s ended session as of its end with `laps` race laps (`FeedPipeline.endedAsOf`). */
  endedAsOf: (feedId: FeedId, laps: number) => AsOfView | undefined;
  /** The race laps to suggest for a race of `format` on `trackId` (`suggestedLapsOf` over the stored sessions). */
  suggestedLaps: (trackId: number, format: RaceFormat) => Known<number>;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
};

/** An open round: its seat, the suggestion, the prepared plans as last read, its job runner and whether it runs. */
type OpenRound = RoundSeat & {
  feedId: FeedId;
  suggested: Known<number>;
  plans: PreparedPlans;
  runner: JobRunner;
  running: boolean;
};

/** Seed of every planning run: the planning job's results depend on its input only. */
const PLANNING_SEED = 0;

/** What a planning result is computed for: before the race's first lap, no frame of the race (as the boards show it). */
const COMPUTED_FOR: ComputedFor = { lap: 0, frameId: 0 };

/** The prepared plans of the car with `raceNumber` (C62); an empty one where the plans hold none. */
const preparedOf = (plans: PreparedPlans, raceNumber: number): PreparedCar =>
  plans.cars.find((c) => c.raceNumber === raceNumber) ?? { raceNumber, slots: {}, active: null };

const sameKey = (a: RaceKey, b: RaceKey): boolean => a.weekendId === b.weekendId && a.format === b.format && a.team === b.team;

/** Without an open round (§7.0 rule 3: no session to plan from). */
const NOT_SUPPORTED: ActionOutcome = { ok: false, reason: 'notSupported' };
const invalid = (message: string): ActionOutcome => ({ ok: false, reason: 'invalid', message });

export class Planning implements PlanningHooks {
  readonly #o: PlanningOptions;
  readonly #rounds = new Map<FeedId, OpenRound>();

  constructor(opts: PlanningOptions) {
    this.#o = opts;
  }

  /** Feed `feedId` runs a session again (or its pipeline was made anew): its round closes, its job is cancelled. */
  sessionStarted(feedId: FeedId): void {
    this.#closeRound(feedId);
    this.#publishPrepared(feedId);
  }

  /** Feed `feedId`'s session ended: a round opens when it ends qualifying (§7.0 rules 3–6), and runs once laps are entered. */
  sessionEnded(feedId: FeedId, ended: EndedSession): void {
    this.#closeRound(feedId);
    // Our cars and every slot's team and race number; the laps are not read here.
    const asOf = this.#o.endedAsOf(feedId, 0);
    const seat = asOf === undefined ? undefined : roundSeatOf(ended, asOf.fixed);    if (seat !== undefined) {
      const runner = new JobRunner({ seed: PLANNING_SEED, limit: this.#o.workerLimit });
      const round: OpenRound = { ...seat, feedId, suggested: this.#o.suggestedLaps(seat.trackId, seat.key.format), plans: this.#read(seat), runner, running: false };
      runner.onResult((result) => this.#onResult(round, result));
      this.#rounds.set(feedId, round);
      this.#run(round);
    }
    this.#publishPrepared(feedId);
  }

  /**
   * A live race's first frame with its team known, on the team's first feed (C62d, C76; §7.0 rules 7–8): the team's
   * prepared plans for the race, read once, as the plan decisions the team's feeds commit (`raceStartDecisions`).
   */
  raceStarted(race: RaceStart): PlanDecision[] {
    const plans = this.#o.store.read({ weekendId: race.weekendId, format: race.format, team: race.team });
    return raceStartDecisions(plans, race.team, race.slots);
  }

  /**
   * A `plans.prepare.*` uiAction (C73): checked against the feed's open round (without one `notSupported`), its laps
   * and slots; a rejection writes nothing. An accepted one writes the team's file and refreshes every open round of
   * the team (C1a).
   */
  apply(action: PrepareAction): ActionOutcome {
    const round = this.#rounds.get(action.feedId);
    if (round === undefined) return NOT_SUPPORTED;
    const plans = this.#read(round);
    const changed = this.#changed(round, plans, action);
    if ('ok' in changed) return changed;
    this.#o.store.write(round.key, changed);
    for (const other of this.#rounds.values()) {
      if (!sameKey(other.key, round.key)) continue;
      other.plans = this.#read(other);
      this.#run(other);
      this.#publishPrepared(other.feedId);
    }
    return { ok: true };
  }

  /** Cancels every running planning job; no result is published afterwards. */
  async close(): Promise<void> {
    const runners = [...this.#rounds.values()].map((round) => round.runner);
    this.#rounds.clear();
    await Promise.all(runners.map((runner) => runner.close()));
  }

  /** The prepared plans after `action`, or its rejection (C73). */
  #changed(round: OpenRound, plans: PreparedPlans, action: PrepareAction): PreparedPlans | ActionOutcome {
    if (action.kind === 'plans.prepare.laps') {
      if (action.laps > MAX_RACE_LAPS) return invalid(`the race's laps are 1 to ${MAX_RACE_LAPS}`);
      return { ...plans, laps: action.laps };
    }
    const raceNumber = round.cars.get(action.carId);
    if (raceNumber === undefined) return invalid(`car ${action.carId} is none of ours`);
    const car = preparedOf(plans, raceNumber);
    let next: PreparedCar;
    switch (action.kind) {
      case 'plans.prepare.save':
      case 'plans.prepare.accept': {
        const { policy } = action;
        if (policy.startCompound === undefined) return invalid('a prepared plan names its start compound');
        const last = plans.laps === null ? undefined : plans.laps - 1;
        if (last !== undefined && policy.stops.some((stop) => stop.lap > last)) return invalid(`a stop lies on laps 1 to ${last}`);
        next = { ...car, slots: { ...car.slots, [action.slot]: policy }, active: action.kind === 'plans.prepare.accept' ? action.slot : car.active };
        break;
      }
      case 'plans.prepare.remove': {
        if (car.slots[action.slot] === undefined) return invalid(`slot ${action.slot} holds no plan`);
        if (car.active === action.slot) return invalid(`slot ${action.slot} is the active plan`);
        const { [action.slot]: _removed, ...slots } = car.slots;
        next = { ...car, slots };
        break;
      }
      case 'plans.prepare.activate':
        if (car.slots[action.slot] === undefined) return invalid(`slot ${action.slot} holds no plan`);
        next = { ...car, active: action.slot };
        break;
    }
    return { ...plans, cars: [...plans.cars.filter((c) => c.raceNumber !== raceNumber), next] };
  }

  /** The team's prepared plans for the round's race, with every car of the round (an empty one where the file has none). */
  #read(seat: RoundSeat): PreparedPlans {
    const plans = this.#o.store.read(seat.key);
    const missing = [...seat.cars.values()].filter((n) => !plans.cars.some((c) => c.raceNumber === n));
    return { ...plans, cars: [...plans.cars, ...missing.map((raceNumber): PreparedCar => ({ raceNumber, slots: {}, active: null }))] };
  }

  /** Runs the round's planning job on its prepared plans, once laps are entered; a newer run replaces a running one. */
  #run(round: OpenRound): void {
    const { laps } = round.plans;
    if (laps === null) return;
    const asOf = this.#o.endedAsOf(round.feedId, laps);
    if (asOf === undefined) return;
    let input: StrategyInput;
    const startedAt = performance.now();
    try {
      const prepared: Record<CarId, { saved: PreparedCar['slots']; active: PreparedCar['active'] }> = {};
      for (const [car, raceNumber] of round.cars) {
        const p = preparedOf(round.plans, raceNumber);
        prepared[car] = { saved: { ...p.slots }, active: p.active };
      }
      input = planningInputFrom(asOf, { laps, prepared });
    } catch (error) {
      this.#o.log.error({ feedId: round.feedId, err: error }, 'planning input not built, preview marked errored');
      this.#o.hub.setStatus(round.feedId, 'plans.preview', 'errored');
      return;
    }
    this.#o.log.info({ feedId: round.feedId, laps, ms: Math.round(performance.now() - startedAt) }, 'planning job triggered');
    round.running = true;
    round.runner.trigger(this.#o.job, input, COMPUTED_FOR);
  }

  /** A planning result: published per our car while its round is open (a closed round's never). */
  #onResult(round: OpenRound, result: JobResult): void {
    if (this.#rounds.get(round.feedId) !== round) return;
    round.running = false;
    const { hub, log } = this.#o;
    if ('error' in result) {
      log.error({ feedId: round.feedId, error: result.error }, 'planning job failed, preview marked errored');
      hub.setStatus(round.feedId, 'plans.preview', 'errored');
    } else {
      const out = result.value as StrategyOutput;
      const { computedFor } = result;
      hub.publishState(round.feedId, 'plans.preview', (params) => {
        const value = selectCar<StrategyCar>(out, params);
        return value === undefined ? undefined : ({ computedFor, value } satisfies Computed<StrategyCar>);
      });
    }
    this.#publishPrepared(round.feedId);
  }

  #closeRound(feedId: FeedId): void {
    const round = this.#rounds.get(feedId);
    if (round === undefined) return;
    this.#rounds.delete(feedId);
    void round.runner.close();
  }

  /** `plans.prepared` of feed `feedId` (C54, C55): its open round, else `{ open: false }`. */
  #publishPrepared(feedId: FeedId): void {
    const round = this.#rounds.get(feedId);
    const value: PlanningRound = round === undefined
      ? { open: false }
      : {
        open: true,
        weekendId: round.key.weekendId,
        format: round.key.format,
        team: round.key.team,
        laps: { entered: round.plans.laps, suggested: round.suggested },
        cars: Object.fromEntries([...round.cars].map(([car, raceNumber]) => [car, preparedOf(round.plans, raceNumber)])),
        running: round.running,
      };
    this.#o.hub.publishState(feedId, 'plans.prepared', () => value);
  }
}
