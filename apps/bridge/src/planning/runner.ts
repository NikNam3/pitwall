// The planning runner (C1a, C3, C51, C54, C61, C62, C62c, C62d, C73; SP4.3e spec §4.0 idea 3, §4.3 "PlanningRunner";
// SP4.3f spec §4.0 idea 1, §4.2): a planning round is a function of the picks: a qualifying stored for a team, a practice
// basis stored for the same team on its track, and the race assumptions. The team is handed forward from the stored
// qualifying (its player car's team), never read from a feed. `check` answers whether picks are valid (C73); `open`
// replays the first stored row of the qualifying of the team (start order): it makes the picks current first (C61,
// `rebuilding` while a stale one is rebuilt), replays the row's recording to its end through the rebuild service
// (`replayToEnd`, priority `planning`, in its worker, never on the thread that applies frames) with the practice rows as
// its basis, the race's conditions in place of the qualifying's race samples and the round's profile snapshot (the
// current one of every car slot of the row, as a session start builds it, C62c) in place of the recording's sidecar, and
// runs the planning job on the input the replay built, with the round's slots, through a `JobRunner` on the bridge's
// shared `WorkerLimit`. It publishes `plans.preview` (the job's result per our car, `Computed<StrategyCar>`; never
// stored, outside the determinism hash, C51) and `plans.prepared` (the round's state, `PlanningRoundState`, C54). New
// race assumptions replay again; a slot edit re-runs the job only. `save` makes the round's slots a saved plan of the
// round's team (C1a), and the team's last saved plan on the track. Without known race laps no replay and no job runs
// (C3). The newest run wins; a closed round's result is never published. A closed feed lists the saved plans of its
// team: its newest round's in this run, or its running session's seat (`publishClosed` with a team); else none.
import { randomUUID } from 'node:crypto';
import type { ActionOutcome, Computed, PlanningRoundState, RoundRace, SavedPlanEntry, UiAction } from '@pitwall/contracts';
import { IMPORTED, raceFormatOf, unknown, type CarId, type FeedId, type ForecastSample, type Policy, type PreparedCar, type ProfileSnapshot, type RaceFormat, type SavedPlan, type SessionRef, type Slot, type StoredSessionRef, type StrategyCar, type StrategyOutput, type TeamId, type TrackId } from '@pitwall/domain';
import type { StrategyInput } from '@pitwall/analysis';
import type { Job } from '@pitwall/engine/readers';
import type { SlotIdentity } from '../drivers/store.ts';
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
import { effectiveForecast, forecastRowsOf, roundCarsOf, slotsOfRow, teamOfRow, type TempsAtEnd } from './round.ts';
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
  /**
   * The stored sessions (C61, C62): a pick names a session ref, the round takes its first row of the team's player car;
   * which are stale, and a qualifying's weekend phase (its race format) once it is current.
   */
  sessions: Pick<WeekendRepository, 'sessionsOf' | 'staleSessionsOf' | 'sessionsOnTrack'>;
  /** The profile store (C62c): the current snapshot of a session's car slots; unset (no store): none. */
  profiles: { snapshotFor(slots: readonly SlotIdentity[], session: StoredSessionRef): ProfileSnapshot | null } | undefined;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** The time a plan is saved at (ISO). Default: now. */
  now?: () => string;
};

/** A round to open: the feed it is published on, the qualifying and its team, the practice basis, the race assumptions. */
export type RoundSpec = { feedId: FeedId; qualifying: SessionRef; team: TeamId; practice: SessionRef[]; race?: RoundRace };

/** The race assumptions a round opened without any starts from, for its qualifying's track and race format (spec §4.4). */
export type RaceDefaults = (trackId: TrackId, format: RaceFormat) => RoundRace;

/** The stored rows of valid picks: the qualifying's first row of the team, and per practice its first row of the team. */
type Picked = { row: StoredSessionRow; pwrecPath: string; practiceRows: StoredSessionRow[] };

/** An open round. `input` is the replay's for the round's race (`undefined` until it arrives); `generation` counts its replays. */
type Round = {
  feedId: FeedId;
  /** The saved plan this round was last saved as (SP4.3f Task 10); `null` until a save. */
  lastSaved: SavedPlanEntry | null;
  qualifying: SessionRef;
  practice: SessionRef[];
  qualifyingKey: SessionKey;
  practiceKeys: SessionKey[];
  pwrecPath: string;
  race: RoundRace;
  /** Set while the race is still to come from the defaults: the qualifying was stale, its race format unknown (C61). */
  defaults: RaceDefaults | undefined;
  team: TeamId;
  trackId: TrackId;
  playerCar: CarId;
  teammateCar: CarId | null;
  /** The stored qualifying's start (ISO). */
  startedAt: string;
  /** The round's profile snapshot (C62c), fixed for the round. */
  profiles: ProfileSnapshot | null;
  /** The qualifying's race samples at its end and its own temperatures then, from its first replay (`undefined` before). */
  imported: ForecastSample[] | undefined;
  atEnd: TempsAtEnd | undefined;
  /** Our cars by slot of the qualifying, each with its prepared plans (by race number, C62). */
  cars: Map<CarId, PreparedCar>;
  input: StrategyInput | undefined;
  generation: number;
  rebuilding: boolean;
  replaying: boolean;
  running: boolean;
  runner: JobRunner;
};

export type PlanningRunner = {
  /** Whether `spec`'s picks are valid (C73; see `check` in the header): the qualifying's track, or the rejection. */
  check(spec: RoundSpec): { ok: true; trackId: TrackId } | { ok: false; reason: 'invalid'; message: string };
  /**
   * Opens feed `spec.feedId`'s round (closing the one it had), makes its picks current, replays and plans once its race
   * laps are known. Invalid picks open nothing (logged). Without `spec.race`: the feed's last round's race when it is of
   * the same qualifying and team, else `defaults` for the qualifying's track and race format (laps unknown without them).
   */
  open(spec: RoundSpec, defaults?: RaceDefaults): Promise<void>;
  /** New race assumptions for the feed's round: replayed and planned again. */
  setRace(feedId: FeedId, race: RoundRace): void;
  /** Closes the feed's round: its job is cancelled, its result dropped. */
  close(feedId: FeedId): void;
  /** Whether the feed has an open round. */
  isOpen(feedId: FeedId): boolean;
  /** A slot action on the feed's round (C73): checked; an accepted one re-runs the job. */
  edit(action: PrepareAction): ActionOutcome;
  /** Saves the feed's round's slot choices as a saved plan of the team (`replaces`: the plan it overwrites). */
  save(feedId: FeedId, o: { name?: string; replaces?: string }): ActionOutcome;
  rename(feedId: FeedId, id: string, name: string): ActionOutcome;
  delete(feedId: FeedId, id: string): ActionOutcome;
  /**
   * `plans.prepared` of a feed without an open round (`{ open: false }`), with its team's saved plans on its track:
   * `trackId` and `team` (the feed's running session's) replace the ones it had when given.
   */
  publishClosed(feedId: FeedId, trackId: TrackId | undefined, team?: TeamId): void;
  /** Cancels every running job; nothing is published afterwards. */
  closeAll(): Promise<void>;
};

/** Seed of every planning run: the planning job's results depend on its input only. */
const PLANNING_SEED = 0;

/** What a planning result is computed for: before the race's first lap, no frame of the race (as the boards show it). */
const COMPUTED_FOR: ComputedFor = { lap: 0, frameId: 0 };

/** A round's race while it waits for its defaults (its qualifying being rebuilt): laps unknown (C3). */
const PENDING_RACE: RoundRace = { laps: null, sets: 'carried', conditions: IMPORTED };

const NOT_SUPPORTED: ActionOutcome = { ok: false, reason: 'notSupported' };
const invalid = (message: string): { ok: false; reason: 'invalid'; message: string } => ({ ok: false, reason: 'invalid', message });

const keyOf = (row: StoredSessionRow): SessionKey => ({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar });
const sameKey = (a: SessionKey, b: SessionKey): boolean => a.sessionUid === b.sessionUid && a.weekendId === b.weekendId && a.playerCar === b.playerCar;
const sameRef = (a: SessionRef, b: SessionRef): boolean => a.sessionUid === b.sessionUid && a.weekendId === b.weekendId;
const refText = (ref: SessionRef): string => `${ref.sessionUid}@${ref.weekendId}`;
const entryOf = (plan: SavedPlan): SavedPlanEntry => ({ id: plan.id, name: plan.name, savedAt: plan.savedAt });
const copyRace = (race: RoundRace): RoundRace => structuredClone(race);

export function createPlanningRunner(o: PlanningRunnerOptions): PlanningRunner {
  const rounds = new Map<FeedId, Round>();
  /** Per feed the track and team its closed state lists saved plans of. */
  const closedTracks = new Map<FeedId, TrackId>();
  const closedTeams = new Map<FeedId, TeamId>();
  /** Per feed its newest round's qualifying, team and race: reopening that qualifying keeps the race (spec §4.4). */
  const lastRaces = new Map<FeedId, { qualifying: SessionRef; team: TeamId; race: RoundRace }>();
  const now = o.now ?? (() => new Date().toISOString());

  /** The first stored row of `ref` (start order) whose player car is of `team` (C62); `undefined` when none is. */
  const rowOf = (ref: SessionRef, team: TeamId): StoredSessionRow | undefined =>
    o.sessions.sessionsOf(ref.weekendId).find((row) => row.sessionUid === ref.sessionUid && teamOfRow(row) === team);

  /** The stored rows of the picks, or why they are invalid (C73; spec §4.2 "the bridge checks the picks"). */
  const pick = (spec: RoundSpec): Picked | string => {
    const row = rowOf(spec.qualifying, spec.team);
    if (row === undefined || row.kind !== 'qualifying') return `qualifying ${refText(spec.qualifying)} is not stored for team ${spec.team}`;
    const { pwrecPath } = row;
    if (pwrecPath === null) return `qualifying ${refText(spec.qualifying)} of team ${spec.team} has no recording`;
    const practiceRows: StoredSessionRow[] = [];
    for (const ref of spec.practice) {
      const stored = rowOf(ref, spec.team);
      if (stored === undefined || stored.kind !== 'practice') return `practice ${refText(ref)} is not stored for team ${spec.team}`;
      if (stored.trackId !== row.trackId) return `practice ${refText(ref)} is of another track than the qualifying`;
      practiceRows.push(stored);
    }
    const laps = spec.race?.laps;
    if (laps !== undefined && laps !== null && (!Number.isInteger(laps) || laps < 1 || laps > MAX_RACE_LAPS)) return `the race's laps are 1 to ${MAX_RACE_LAPS}`;
    return { row, pwrecPath, practiceRows };
  };

  const savedOf = (team: TeamId | undefined, trackId: TrackId | undefined): SavedPlanEntry[] =>
    team === undefined || trackId === undefined ? [] : o.store.list(team, trackId).map(entryOf);

  /** The samples the round plans on: `[]` while its replay has not returned. */
  const forecastOf = (round: Round): ForecastSample[] =>
    round.imported === undefined || round.atEnd === undefined ? [] : effectiveForecast(round.race.conditions, round.imported, round.atEnd);

  const stateOf = (round: Round): PlanningRoundState => ({
    open: true,
    qualifying: round.qualifying,
    practice: round.practice,
    race: round.race,
    team: round.team,
    trackId: round.trackId,
    playerCar: round.playerCar,
    teammateCar: round.teammateCar,
    forecast: {
      source: { ref: round.qualifying, startedAt: round.startedAt },
      rows: round.imported === undefined || round.atEnd === undefined ? unknown('notReceived') : forecastRowsOf(round.race.conditions, round.imported, round.atEnd),
    },
    rebuilding: round.rebuilding,
    cars: Object.fromEntries(round.cars),
    running: round.replaying || round.running,
    saved: savedOf(round.team, round.trackId),
    lastSaved: round.lastSaved,
  });

  const publish = (round: Round): void => {
    const value = stateOf(round);
    o.hub.publishState(round.feedId, 'plans.prepared', () => value);
  };

  const publishClosed = (feedId: FeedId, trackId: TrackId | undefined, team?: TeamId): void => {
    if (trackId !== undefined) closedTracks.set(feedId, trackId);
    if (team !== undefined) closedTeams.set(feedId, team);
    const value: PlanningRoundState = { open: false, saved: savedOf(closedTeams.get(feedId), closedTracks.get(feedId)) };
    o.hub.publishState(feedId, 'plans.prepared', () => value);
  };

  /** Every feed of `team` publishes again (its saved plans changed, C1a): its open round, else its closed state. */
  const republishTeam = (team: TeamId): void => {
    for (const round of rounds.values()) if (round.team === team) publish(round);
    for (const [feedId, closedTeam] of closedTeams) {
      if (!rounds.has(feedId) && closedTeam === team) publishClosed(feedId, undefined);
    }
  };

  const isCurrent = (round: Round): boolean => rounds.get(round.feedId) === round;

  /** The round's race from its defaults, once its qualifying is current: its race format from its weekend phase (C14). */
  const raceFromDefaults = (round: Round, defaults: RaceDefaults): RoundRace => {
    const stored = o.sessions.sessionsOnTrack(round.trackId).find((s) => sameKey(keyOf(s), round.qualifyingKey));
    const phase = stored?.stale === false ? stored.phase : undefined;
    return phase?.kind === 'qualifying' ? defaults(round.trackId, raceFormatOf(phase.format)) : PENDING_RACE;
  };

  /** Whether any of `keys` (default: the round's picks) is stale (C61). */
  const hasStale = (round: Round, keys: readonly SessionKey[] = [round.qualifyingKey, ...round.practiceKeys]): boolean => {
    const weekends = [...new Set(keys.map((k) => k.weekendId))];
    return weekends.some((weekendId) => o.sessions.staleSessionsOf(weekendId).some((row) => keys.some((k) => sameKey(k, keyOf(row)))));
  };

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

  /**
   * Makes the round's picks current (C61; `rebuilding` while a stale one is rebuilt), then replays its qualifying for its
   * race (once its laps are known) and runs the job; the newest replay wins.
   */
  const replay = async (round: Round): Promise<void> => {
    const generation = ++round.generation;
    const latest = (): boolean => isCurrent(round) && round.generation === generation;
    round.input = undefined;
    round.runner.cancel();
    round.running = false;
    const stale = hasStale(round);
    if (round.race.laps === null && round.defaults === undefined && !stale) {
      round.replaying = false;
      publish(round);
      return;
    }
    round.rebuilding = stale;
    round.replaying = true;
    publish(round);
    let result: PlanningReplay | null;
    try {
      await o.rebuild.ensureCurrent([round.qualifyingKey, ...round.practiceKeys], { priority: 'planning' });
      if (!latest()) return;
      round.rebuilding = false;
      if (round.defaults !== undefined) {
        round.race = raceFromDefaults(round, round.defaults);
        round.defaults = undefined;
        lastRaces.set(round.feedId, { qualifying: round.qualifying, team: round.team, race: copyRace(round.race) });
      }
      const { laps, sets, conditions } = round.race;
      if (laps === null) {
        round.replaying = false;
        publish(round);
        return;
      }
      publish(round);
      const job = { pwrecPath: round.pwrecPath, basisOverride: round.practiceKeys, laps, sets, conditions, profiles: round.profiles };
      result = await o.rebuild.replayToEnd<PlanningReplay | null>(job, 'planning');
    } catch (error) {
      result = null;
      if (latest()) o.log.error({ feedId: round.feedId, err: error }, 'planning replay failed, preview marked errored');
    }
    if (!latest()) return;
    round.rebuilding = false;
    round.replaying = false;
    if (result === null) {
      o.hub.setStatus(round.feedId, 'plans.preview', 'errored');
      publish(round);
      return;
    }
    round.imported = result.imported;
    round.atEnd = result.atEnd;
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

  /** The saved plan `id` of `feedId`'s team (its round's, else its closed state's), or why not. */
  const teamPlan = (feedId: FeedId, id: string): SavedPlan | string => {
    const team = rounds.get(feedId)?.team ?? closedTeams.get(feedId);
    const plan = o.store.read(id);
    return plan === undefined || team === undefined || plan.team !== team ? `no saved plan ${id} of the team` : plan;
  };

  return {
    check(spec) {
      const picked = pick(spec);
      return typeof picked === 'string' ? invalid(picked) : { ok: true, trackId: picked.row.trackId as TrackId };
    },

    async open(spec, defaults) {
      const picked = pick(spec);
      if (typeof picked === 'string') {
        o.log.warn({ feedId: spec.feedId, qualifying: spec.qualifying, team: spec.team, reason: picked }, 'planning round not opened');
        return;
      }
      drop(spec.feedId);
      const { row, pwrecPath, practiceRows } = picked;
      const qualifying: SessionRef = { sessionUid: spec.qualifying.sessionUid, weekendId: spec.qualifying.weekendId };
      const last = lastRaces.get(spec.feedId);
      const kept = spec.race === undefined && last !== undefined && sameRef(last.qualifying, qualifying) && last.team === spec.team ? last.race : undefined;
      const given = spec.race ?? kept;
      const cars = new Map<CarId, PreparedCar>([...roundCarsOf(row)].map(([car, raceNumber]) => [car, { raceNumber, slots: {}, active: null }]));
      const runner = new JobRunner({ seed: PLANNING_SEED, limit: o.jobs.workerLimit });
      // the current profile snapshot of every car slot of the qualifying, as a session start asks for it (C62c)
      const profiles = o.profiles?.snapshotFor(slotsOfRow(row), { sessionUid: row.sessionUid, weekendId: row.weekendId, feedCar: row.playerCar }) ?? null;
      const round: Round = {
        feedId: spec.feedId,
        qualifying,
        practice: spec.practice.map(({ sessionUid, weekendId }) => ({ sessionUid, weekendId })),
        qualifyingKey: keyOf(row),
        practiceKeys: practiceRows.map(keyOf),
        pwrecPath,
        race: given === undefined ? copyRace(PENDING_RACE) : copyRace(given),
        defaults: undefined,
        team: spec.team,
        trackId: row.trackId as TrackId,
        playerCar: row.playerCar,
        teammateCar: row.teammateCar,
        startedAt: row.startedAt,
        profiles,
        imported: undefined,
        atEnd: undefined,
        cars,
        input: undefined,
        generation: 0,
        lastSaved: null,
        rebuilding: false,
        replaying: false,
        running: false,
        runner,
      };
      // without a race: the defaults for the qualifying's race format, now if it is current, else once it is (C61)
      if (given === undefined && defaults !== undefined) {
        if (hasStale(round, [round.qualifyingKey])) round.defaults = defaults;
        else round.race = raceFromDefaults(round, defaults);
      }
      runner.onResult((result) => onResult(round, result));
      rounds.set(spec.feedId, round);
      closedTracks.set(spec.feedId, round.trackId);
      closedTeams.set(spec.feedId, round.team);
      if (round.defaults === undefined) lastRaces.set(spec.feedId, { qualifying, team: round.team, race: copyRace(round.race) });
      await replay(round);
    },

    setRace(feedId, race) {
      const round = rounds.get(feedId);
      if (round === undefined) return;
      round.race = copyRace(race);
      round.defaults = undefined;
      lastRaces.set(feedId, { qualifying: round.qualifying, team: round.team, race: copyRace(race) });
      void replay(round);
    },

    close(feedId) {
      const round = drop(feedId);
      if (round !== undefined) publishClosed(feedId, round.trackId);
    },

    isOpen: (feedId) => rounds.has(feedId),

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
      const { laps, sets, conditions } = round.race;
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
        // for display only (C62d): the race assumptions as computed, the samples planned on, the profile snapshot's fingerprint
        computedOn: {
          basis: { practice: round.practice, qualifying: round.qualifying },
          race: structuredClone({ laps, sets, conditions }),
          forecast: forecastOf(round),
          profiles: round.profiles?.fingerprint ?? null,
        },
        cars: [...round.cars.values()].map((car) => structuredClone(car)),
      };
      o.store.save(plan);
      round.lastSaved = entryOf(plan);
      // the team's last saved plan on the track (C62d); a save confirms no basis (C62): the last choice keeps its kinds
      const last = o.lastChoice.read(round.team, round.trackId);
      o.lastChoice.write(round.team, { trackId: round.trackId, basis: last?.basis ?? {}, plan: { id: plan.id, at: savedAt } });
      republishTeam(round.team);
      return { ok: true };
    },

    rename(feedId, id, name) {
      const plan = teamPlan(feedId, id);
      if (typeof plan === 'string') return invalid(plan);
      o.store.rename(id, name);
      republishTeam(plan.team);
      return { ok: true };
    },

    delete(feedId, id) {
      const plan = teamPlan(feedId, id);
      if (typeof plan === 'string') return invalid(plan);
      o.store.delete(id);
      republishTeam(plan.team);
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
