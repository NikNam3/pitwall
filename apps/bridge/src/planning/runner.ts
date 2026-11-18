// The planning runner (C1a, C51, C54, C62d, C73; SP4.3e spec §4.0 idea 3, §4.3 "PlanningRunner"): a planning round is a
// function of a qualifying recording, a practice basis and the race assumptions. `open` finds the qualifying stored for
// the feed's seat (C62), makes its practice basis current (C61), replays the qualifying's recording to its end through
// the rebuild service (`replayToEnd`, priority `planning`, in its worker, never on the thread that applies frames) with
// that practice as its basis, and runs the planning job on the input the replay built, with the round's slots, through
// a `JobRunner` on the bridge's shared `WorkerLimit`. It publishes `plans.preview` (the job's result per our car,
// `Computed<StrategyCar>`; never stored, outside the determinism hash, C51) and `plans.prepared` (the round's state,
// `PlanningRoundState`, C54). New race assumptions replay again; a slot edit re-runs the job only. The round's slots
// live in the round; `save` makes them a saved plan of the team (C1a), and the team's last saved plan on the track.
// Without known race laps no replay and no job runs (C3). The newest run wins; a closed round's result is never published.
import { randomUUID } from 'node:crypto';
import type { ActionOutcome, Computed, PlanningRoundState, RoundRace, SavedPlanEntry, UiAction } from '@pitwall/contracts';
import { type CarId, type CarKey, type FeedId, type Policy, type PreparedCar, type SavedPlan, type SessionRef, type Slot, type StrategyCar, type StrategyOutput, type TeamId, type TrackId } from '@pitwall/domain';
import type { StrategyInput } from '@pitwall/analysis';
import type { Job } from '@pitwall/engine/readers';
import { selectCar } from '../features/feature.ts';
import type { TopicHub } from '../hub/topic-hub.ts';
import { JobRunner, type ComputedFor, type JobResult } from '../jobs/job-runner.ts';
import type { WorkerLimit } from '../jobs/worker-limit.ts';
import type { Logger } from '../log.ts';
import type { LastChoiceStore } from '../pipeline/last-choice-types.ts';
import type { SessionKey, StoredSessionRow } from '../storage/db.ts';
import type { RebuildService } from '../storage/rebuild-service-types.ts';
import type { WeekendRepository } from '../storage/weekend-repository.ts';
import type { PlanningReplay } from './replay.ts';
import { isSeatOf, roundCarsOf } from './round.ts';
import { MAX_RACE_LAPS, type SavedPlanStore } from './saved-plans.ts';

/** The round's slot actions (C73). */
export type PrepareAction = Extract<UiAction, { kind: `plans.prepare.${string}` }>;

export type PlanningRunnerOptions = {
  rebuild: Pick<RebuildService, 'ensureCurrent' | 'replayToEnd'>;
  /** The planning job (its `prepare` is never called: its input is the replay's) and the bridge's one worker limit (C1a, C51). */
  jobs: { job: Job<StrategyInput, StrategyOutput>; workerLimit: WorkerLimit };
  hub: TopicHub;
  store: SavedPlanStore;
  lastChoice: LastChoiceStore;
  /** The stored sessions: a `SessionRef` of the feed's seat names the one whose player car has the seat's key (C62). */
  sessions: Pick<WeekendRepository, 'sessionsOf'>;
  /** The feed's seat: its player car's team and race number; `undefined` while not known. */
  seatOf: (feedId: FeedId) => CarKey | undefined;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** The time a plan is saved at (ISO). Default: now. */
  now?: () => string;
  /**
   * A saved plan was overwritten or renamed (`plan`: as stored now) or deleted (`undefined`): the running races showing
   * it show the change (C62d, `basis.active`).
   */
  planChanged?: (id: string, plan: SavedPlan | undefined) => void;
};

/** A round to open: the feed, the qualifying (of the feed's seat), the practice basis and the race assumptions. */
export type RoundSpec = { feedId: FeedId; qualifying: SessionRef; practice: SessionRef[]; race: RoundRace };

/** An open round. `input` is the replay's for the round's race (`undefined` until it arrives); `generation` counts its replays. */
type Round = {
  feedId: FeedId;
  qualifying: SessionRef;
  practice: SessionRef[];
  practiceKeys: SessionKey[];
  pwrecPath: string;
  race: RoundRace;
  team: TeamId;
  trackId: TrackId;
  /** Our cars by slot of the qualifying, each with its prepared plans (by race number, C62). */
  cars: Map<CarId, PreparedCar>;
  input: StrategyInput | undefined;
  generation: number;
  replaying: boolean;
  running: boolean;
  runner: JobRunner;
};

export type PlanningRunner = {
  /** Opens feed `spec.feedId`'s round (closing the one it had), replays and plans once its race laps are known. */
  open(spec: RoundSpec): Promise<void>;
  /** New race assumptions for the feed's round: replayed and planned again. */
  setRace(feedId: FeedId, race: RoundRace): void;
  /** Closes the feed's round: its job is cancelled, its result dropped. */
  close(feedId: FeedId): void;
  /** Whether the feed has an open round. */
  isOpen(feedId: FeedId): boolean;
  /** The round's laps, `null` while unknown; `undefined` without a round. */
  laps(feedId: FeedId): number | null | undefined;
  /** A slot action on the feed's round (C73): checked; an accepted one re-runs the job. */
  edit(action: PrepareAction): ActionOutcome;
  /** Saves the feed's round's slot choices as a saved plan of the team (`replaces`: the plan it overwrites). */
  save(feedId: FeedId, o: { name?: string; replaces?: string }): ActionOutcome;
  rename(feedId: FeedId, id: string, name: string): ActionOutcome;
  delete(feedId: FeedId, id: string): ActionOutcome;
  /** `plans.prepared` of a feed without an open round (`{ open: false }`), with the team's saved plans on `trackId`. */
  publishClosed(feedId: FeedId, trackId: TrackId | undefined): void;
  /** Cancels every running job; nothing is published afterwards. */
  closeAll(): Promise<void>;
};

/** Seed of every planning run: the planning job's results depend on its input only. */
const PLANNING_SEED = 0;

/** What a planning result is computed for: before the race's first lap, no frame of the race (as the boards show it). */
const COMPUTED_FOR: ComputedFor = { lap: 0, frameId: 0 };

const NOT_SUPPORTED: ActionOutcome = { ok: false, reason: 'notSupported' };
const invalid = (message: string): ActionOutcome => ({ ok: false, reason: 'invalid', message });

const keyOf = (row: StoredSessionRow): SessionKey => ({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar });
const entryOf = (plan: SavedPlan): SavedPlanEntry => ({ id: plan.id, name: plan.name, savedAt: plan.savedAt });

export function createPlanningRunner(o: PlanningRunnerOptions): PlanningRunner {
  const rounds = new Map<FeedId, Round>();
  /** Per feed the track its closed state lists saved plans of. */
  const closedTracks = new Map<FeedId, TrackId>();
  const now = o.now ?? (() => new Date().toISOString());

  /** The stored session `ref` of `seat`'s player car (C62); `undefined` when none is stored. */
  const storedOf = (ref: SessionRef, seat: CarKey): StoredSessionRow | undefined =>
    o.sessions.sessionsOf(ref.weekendId).find((row) => row.sessionUid === ref.sessionUid && isSeatOf(row, seat));

  const savedOf = (team: TeamId | undefined, trackId: TrackId | undefined): SavedPlanEntry[] =>
    team === undefined || trackId === undefined ? [] : o.store.list(team, trackId).map(entryOf);

  const stateOf = (round: Round): PlanningRoundState => ({
    open: true,
    qualifying: round.qualifying,
    practice: round.practice,
    race: round.race,
    team: round.team,
    cars: Object.fromEntries(round.cars),
    running: round.replaying || round.running,
    saved: savedOf(round.team, round.trackId),
  });

  const publish = (round: Round): void => {
    const value = stateOf(round);
    o.hub.publishState(round.feedId, 'plans.prepared', () => value);
  };

  const publishClosed = (feedId: FeedId, trackId: TrackId | undefined): void => {
    if (trackId !== undefined) closedTracks.set(feedId, trackId);
    const value: PlanningRoundState = { open: false, saved: savedOf(o.seatOf(feedId)?.teamId, closedTracks.get(feedId)) };
    o.hub.publishState(feedId, 'plans.prepared', () => value);
  };

  /** Every feed of `team` publishes again (its saved plans changed, C1a): its open round, else its closed state. */
  const republishTeam = (team: TeamId): void => {
    for (const round of rounds.values()) if (round.team === team) publish(round);
    for (const feedId of closedTracks.keys()) {
      if (!rounds.has(feedId) && o.seatOf(feedId)?.teamId === team) publishClosed(feedId, undefined);
    }
  };

  const isCurrent = (round: Round): boolean => rounds.get(round.feedId) === round;

  /** The round's input with its slots (C62d): per our car its active slot's policy committed and its slots. */
  const inputOf = (round: Round, base: StrategyInput): StrategyInput => {
    const committed: Record<CarId, Policy | null> = {};
    const slots: NonNullable<StrategyInput['slots']> = {};
    for (const car of base.ourCars) {
      const prepared = round.cars.get(car);
      const saved = { ...(prepared?.slots ?? {}) };
      const active = prepared?.active ?? null;
      committed[car] = active === null ? null : (saved[active] ?? null);
      slots[car] = { saved, active };
    }
    return { ...base, committed, slots };
  };

  /** Runs the round's planning job on its input with its slots; a newer run replaces a running one. */
  const run = (round: Round): void => {
    if (round.input === undefined || !isCurrent(round)) return;
    round.running = true;
    o.log.info({ feedId: round.feedId, laps: round.race.laps, sets: round.race.sets }, 'planning job triggered');
    round.runner.trigger(o.jobs.job, inputOf(round, round.input), COMPUTED_FOR);
    publish(round);
  };

  /** Replays the round's qualifying for its race (once its laps are known), then runs the job; the newest replay wins. */
  const replay = async (round: Round): Promise<void> => {
    const { laps, sets } = round.race;
    const generation = ++round.generation;
    round.input = undefined;
    round.runner.cancel();
    round.running = false;
    if (laps === null) {
      round.replaying = false;
      publish(round);
      return;
    }
    round.replaying = true;
    publish(round);
    let result: PlanningReplay | null;
    try {
      await o.rebuild.ensureCurrent(round.practiceKeys, { priority: 'planning' });
      result = await o.rebuild.replayToEnd<PlanningReplay | null>({ pwrecPath: round.pwrecPath, basisOverride: round.practiceKeys, laps, sets }, 'planning');
    } catch (error) {
      result = null;
      if (isCurrent(round) && round.generation === generation) o.log.error({ feedId: round.feedId, err: error }, 'planning replay failed, preview marked errored');
    }
    if (!isCurrent(round) || round.generation !== generation) return;
    round.replaying = false;
    if (result === null) {
      o.hub.setStatus(round.feedId, 'plans.preview', 'errored');
      publish(round);
      return;
    }
    round.input = result.input;
    run(round);
  };

  const onResult = (round: Round, result: JobResult): void => {
    if (!isCurrent(round)) return;
    round.running = false;
    if ('error' in result) {
      o.log.error({ feedId: round.feedId, error: result.error }, 'planning job failed, preview marked errored');
      o.hub.setStatus(round.feedId, 'plans.preview', 'errored');
    } else {
      const out = result.value as StrategyOutput;
      const { computedFor } = result;
      o.hub.publishState(round.feedId, 'plans.preview', (params) => {
        const value = selectCar<StrategyCar>(out, params);
        return value === undefined ? undefined : ({ computedFor, value } satisfies Computed<StrategyCar>);
      });
    }
    publish(round);
  };

  const drop = (feedId: FeedId): Round | undefined => {
    const round = rounds.get(feedId);
    if (round === undefined) return undefined;
    rounds.delete(feedId);
    void round.runner.close();
    return round;
  };

  /** The prepared car after a slot action, or its rejection (C73). */
  const changed = (round: Round, action: PrepareAction): PreparedCar | ActionOutcome => {
    const car = round.cars.get(action.carId);
    if (car === undefined) return invalid(`car ${action.carId} is none of ours`);
    switch (action.kind) {
      case 'plans.prepare.save':
      case 'plans.prepare.accept': {
        const { policy } = action;
        if (policy.startCompound === undefined) return invalid('a prepared plan names its start compound');
        const { laps } = round.race;
        if (laps !== null && policy.stops.some((stop) => stop.lap < 1 || stop.lap > laps - 1)) return invalid(`a stop lies on laps 1 to ${laps - 1}`);
        return { ...car, slots: { ...car.slots, [action.slot]: policy }, active: action.kind === 'plans.prepare.accept' ? action.slot : car.active };
      }
      case 'plans.prepare.remove': {
        if (car.slots[action.slot] === undefined) return invalid(`slot ${action.slot} holds no plan`);
        if (car.active === action.slot) return invalid(`slot ${action.slot} is the active plan`);
        const { [action.slot]: _removed, ...slots } = car.slots;
        return { ...car, slots };
      }
      case 'plans.prepare.activate':
        if (car.slots[action.slot] === undefined) return invalid(`slot ${action.slot} holds no plan`);
        return { ...car, active: action.slot as Slot };
    }
  };

  /** The saved plan `id` of `feedId`'s team, or why not. */
  const teamPlan = (feedId: FeedId, id: string): SavedPlan | string => {
    const team = rounds.get(feedId)?.team ?? o.seatOf(feedId)?.teamId;
    const plan = o.store.read(id);
    return plan === undefined || team === undefined || plan.team !== team ? `no saved plan ${id} of the team` : plan;
  };

  return {
    async open(spec) {
      drop(spec.feedId);
      const seat = o.seatOf(spec.feedId);
      const row = seat && storedOf(spec.qualifying, seat);
      if (seat === undefined || row === undefined || row.pwrecPath === null) {
        o.log.warn({ feedId: spec.feedId, qualifying: spec.qualifying }, 'planning round not opened: the qualifying of the feed\'s seat is not stored with its recording');
        publishClosed(spec.feedId, row?.trackId);
        return;
      }
      const practiceKeys = spec.practice.flatMap((ref) => {
        const stored = storedOf(ref, seat);
        return stored === undefined ? [] : [keyOf(stored)];
      });
      const cars = new Map<CarId, PreparedCar>([...roundCarsOf(row)].map(([car, raceNumber]) => [car, { raceNumber, slots: {}, active: null }]));
      const runner = new JobRunner({ seed: PLANNING_SEED, limit: o.jobs.workerLimit });
      const round: Round = {
        feedId: spec.feedId,
        qualifying: { sessionUid: spec.qualifying.sessionUid, weekendId: spec.qualifying.weekendId },
        practice: spec.practice.map(({ sessionUid, weekendId }) => ({ sessionUid, weekendId })),
        practiceKeys,
        pwrecPath: row.pwrecPath,
        race: { ...spec.race },
        team: seat.teamId,
        trackId: row.trackId,
        cars,
        input: undefined,
        generation: 0,
        replaying: false,
        running: false,
        runner,
      };
      runner.onResult((result) => onResult(round, result));
      rounds.set(spec.feedId, round);
      closedTracks.set(spec.feedId, row.trackId);
      await replay(round);
    },

    setRace(feedId, race) {
      const round = rounds.get(feedId);
      if (round === undefined) return;
      round.race = { ...race };
      void replay(round);
    },

    close(feedId) {
      const round = drop(feedId);
      if (round !== undefined) publishClosed(feedId, round.trackId);
    },

    isOpen: (feedId) => rounds.has(feedId),

    laps: (feedId) => rounds.get(feedId)?.race.laps,

    edit(action) {
      const round = rounds.get(action.feedId);
      if (round === undefined) return NOT_SUPPORTED;
      const next = changed(round, action);
      if ('ok' in next) return next;
      round.cars.set(action.carId, next);
      if (round.input === undefined) publish(round);
      else run(round);
      return { ok: true };
    },

    save(feedId, { name, replaces }) {
      const round = rounds.get(feedId);
      if (round === undefined) return NOT_SUPPORTED;
      const { laps, sets } = round.race;
      if (laps === null) return invalid('the race laps are not known: set the race assumptions first');
      let id: string = randomUUID();
      let plannedName = name;
      if (replaces !== undefined) {
        const old = teamPlan(feedId, replaces);
        if (typeof old === 'string') return invalid(old);
        if (old.trackId !== round.trackId) return invalid(`saved plan ${replaces} is of another track`);
        id = old.id;
        plannedName ??= old.name;
      }
      const savedAt = now();
      const plan: SavedPlan = {
        id,
        name: plannedName ?? `Plan ${savedAt.slice(0, 16).replace('T', ' ')}`,
        team: round.team,
        trackId: round.trackId,
        savedAt,
        computedOn: { basis: { practice: round.practice, qualifying: round.qualifying }, race: { laps, sets } },
        cars: [...round.cars.values()].map((car) => structuredClone(car)),
      };
      o.store.save(plan);
      // the team's last saved plan on the track (C62d); a save confirms no basis (C62): the last choice keeps its kinds
      const last = o.lastChoice.read(round.team, round.trackId);
      o.lastChoice.write(round.team, { trackId: round.trackId, basis: last?.basis ?? {}, plan: { id: plan.id, at: savedAt } });
      republishTeam(round.team);
      if (replaces !== undefined) o.planChanged?.(plan.id, plan);
      return { ok: true };
    },

    rename(feedId, id, name) {
      const plan = teamPlan(feedId, id);
      if (typeof plan === 'string') return invalid(plan);
      o.store.rename(id, name);
      republishTeam(plan.team);
      o.planChanged?.(id, o.store.read(id));
      return { ok: true };
    },

    delete(feedId, id) {
      const plan = teamPlan(feedId, id);
      if (typeof plan === 'string') return invalid(plan);
      o.store.delete(id);
      republishTeam(plan.team);
      o.planChanged?.(id, undefined);
      return { ok: true };
    },

    publishClosed,

    async closeAll() {
      const runners = [...rounds.values()].map((round) => round.runner);
      rounds.clear();
      await Promise.all(runners.map((runner) => runner.close()));
    },
  };
}

export { MAX_RACE_LAPS };
