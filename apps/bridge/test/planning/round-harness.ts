// The planning round's test harness (SP4.3f Task 3; C51, C61, C62, C62c, C62d, C73, C84; spec §4.2, §4.5): synthetic
// sessions (`writeSynthetic`, Task 0c) stored in a fresh temporary data dir, and the planning module over the planning
// runner, in process: the real rebuild service (its calls recorded first, its `ensureCurrent` optionally held), a
// `TopicHub` whose one client subscribes `plans.prepared` and `plans.preview`, and the planning job's capture stand-in
// (`planning-capture-stub-job.ts`), so a test reads the inputs the job was handed. No feed pipeline runs. `serveBridge`
// is the same data dir behind a live `serve` with no traffic, its WebSocket client subscribed to `plans.prepared`.
//
// Seams the implement phase adds (the imports type-check once it has):
//  - `createPlanningRunner(o)` without `seatOf`, with `profiles: { snapshotFor(slots, session) }` (the round builds
//    the current profile snapshot of every car slot of the qualifying's row, as a session start does, C62c); its `open`
//    takes `RoundSpec = { feedId, qualifying, team, practice, race? }`;
//  - `new Planning(o)` without `seats`: `{ runner, store, lastChoice, suggestedLaps, log }`; `apply('plans.round.open')`
//    checks the picks (the stored rows through the runner, which reads them via `sessionsOf`) and answers synchronously;
//  - `ReplayJob` with `conditions: RaceConditions` and `profiles: ProfileSnapshot | null`.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize } from 'node:v8';
import { expect, vi } from 'vitest';
import WebSocket from 'ws';
import type { ActionOutcome, Computed, PlanningRoundState, ServerMessage, TopicName, UiAction } from '@pitwall/contracts';
import { feedId, known, unknown, type ForecastSample, type ProfileSnapshot, type RaceFormat, type RoundRace, type SessionRef, type StrategyCar, type StrategyOutput, type TrackId } from '@pitwall/domain';
import type { StrategyInput } from '@pitwall/analysis';
import type { Job } from '@pitwall/engine/readers';
import { processRecording } from '../../src/cli/process-recording.ts';
import { serve } from '../../src/cli/serve.ts';
import type { SlotIdentity } from '../../src/drivers/store.ts';
import { loadFeatureConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { WorkerLimit } from '../../src/jobs/worker-limit.ts';
import { createLogger } from '../../src/log.ts';
import { createLastChoiceStore } from '../../src/pipeline/last-choice.ts';
import { Planning, type PlanningAction } from '../../src/planning/planning.ts';
import { createPlanningRunner } from '../../src/planning/runner.ts';
import { SavedPlanStore } from '../../src/planning/saved-plans.ts';
import { dataDir, type DataDir } from '../../src/storage/data-dir.ts';
import { openDatabase, type Db, type SessionKey } from '../../src/storage/db.ts';
import { createRebuildService } from '../../src/storage/rebuild-service.ts';
import type { RebuildPriority, RebuildService, ReplayJob } from '../../src/storage/rebuild-service-types.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { writeSynthetic, type SyntheticSession } from '../../../../test-support/recordings/index.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { CAPTURE_ENV } from './planning-capture-stub-job.ts';

/** The rules version the sessions are stored with and the bridge runs (a stale session is stored with another). */
export const RULES = 'unversioned';
export const OLDER_RULES = 'rules-of-an-older-bridge';
export const F = feedId('udp-20777');
export const TRACK = 15 as TrackId;
export const OTHER_TRACK = 16 as TrackId;
export const WEEKEND = 4321;
/** Our team; team 1 is another team of the grid. */
export const TEAM = 0;
export const OTHER_TEAM = 1;
/** The race laps the bridge suggests on the track (the harness's `suggestedLaps`); few, so the job is short. */
export const SUGGESTED = 5;

/** The qualifying's grid: slots 0–17 two per team 1…9 (race number 10 + slot), team 0's #64 in slot 18 and #2 in slot 19. */
export const QUALIFYING_CARS: SyntheticSession['cars'] = Array.from({ length: 20 }, (_, i) =>
  i === 18 ? { teamId: TEAM, raceNumber: 64 } : i === 19 ? { teamId: TEAM, raceNumber: 2 } : { teamId: 1 + Math.floor(i / 2), raceNumber: 10 + i });
/** A practice's grid, our cars in other slots: team 0's #2 in slot 0 and #64 in slot 1, team 1's #10 and #11 in slots 2 and 3. */
export const PRACTICE_CARS: SyntheticSession['cars'] = [
  { teamId: TEAM, raceNumber: 2 },
  { teamId: TEAM, raceNumber: 64 },
  { teamId: OTHER_TEAM, raceNumber: 10 },
  { teamId: OTHER_TEAM, raceNumber: 11 },
];
/** The race samples the qualifying's Session packets carry (game units: minutes, weather 1 light cloud, 3 light rain). */
export const RACE_SAMPLES: NonNullable<SyntheticSession['raceSamples']> = [
  { offsetMin: 0, weather: 1, rainPct: 12 },
  { offsetMin: 30, weather: 3, rainPct: 45 },
];

export const silent = createLogger({ level: 'silent' });

const cleanup: Array<() => unknown> = [];
/** Every test file's `afterEach`: stops what the harness started, newest first. */
export async function cleanUp(): Promise<void> {
  for (const c of cleanup.splice(0).reverse()) await c();
}

export type Place = { dirs: DataDir; db: Db };

/** A fresh temporary data dir (C84) and its database (`live.db`, as `serveBridge` opens it). */
export function newPlace(): Place {
  const root = mkdtempSync(join(tmpdir(), 'pitwall-round-'));
  const dirs = dataDir({ PITWALL_DATA_DIR: root });
  mkdirSync(dirs.recordings, { recursive: true });
  const db = openDatabase(join(root, 'live.db'));
  cleanup.push(() => db.close());
  return { dirs, db };
}

export type Stored = { ref: SessionRef; key: SessionKey; file: string };

/** `s` written as a recording into the place's recordings (`<name>.pwrec.gz`) and stored under `rules`. */
export async function storeSession(place: Place, name: string, s: SyntheticSession, rules = RULES): Promise<Stored> {
  const file = join(place.dirs.recordings, `${name}.pwrec.gz`);
  await writeSynthetic(file, s);
  await processRecording(file, place.db, silent, new AbortController().signal, loadFeatureConfig(place.dirs.root, FEATURES), rules);
  const rows = place.db.prepare('SELECT session_uid, weekend_id, player_car FROM sessions WHERE pwrec_path = ?').all(file) as Array<{ session_uid: string; weekend_id: string; player_car: number }>;
  if (rows.length !== 1) throw new Error(`${file}: expected one stored session, got ${rows.length}`);
  const key = { sessionUid: rows[0]!.session_uid, weekendId: rows[0]!.weekend_id, playerCar: rows[0]!.player_car } as SessionKey;
  return { ref: { sessionUid: key.sessionUid, weekendId: key.weekendId }, key, file };
}

/** A qualifying of the grid on the track (default: uid 70, the player #2 in slot 19, with the race samples). */
export const storeQualifying = (place: Place, o: { name?: string; uid?: bigint; player?: number; samples?: SyntheticSession['raceSamples']; track?: number; rules?: string } = {}): Promise<Stored> =>
  storeSession(place, o.name ?? `qualifying-${o.uid ?? 70n}-${o.player ?? 19}`, {
    sessionUid: o.uid ?? 70n,
    weekendId: WEEKEND,
    trackId: o.track ?? TRACK,
    kind: 'qualifying',
    player: o.player ?? 19,
    cars: QUALIFYING_CARS,
    raceSamples: o.samples ?? RACE_SAMPLES,
  }, o.rules ?? RULES);

/** A practice of `PRACTICE_CARS` (default: uid 69 on the track, the player #2 of team 0 in slot 0). */
export const storePractice = (place: Place, o: { name?: string; uid?: bigint; player?: number; track?: number; rules?: string } = {}): Promise<Stored> =>
  storeSession(place, o.name ?? `practice-${o.uid ?? 69n}-${o.player ?? 0}`, {
    sessionUid: o.uid ?? 69n,
    weekendId: WEEKEND,
    trackId: o.track ?? TRACK,
    kind: 'practice',
    player: o.player ?? 0,
    cars: PRACTICE_CARS,
  }, o.rules ?? RULES);

/** The stored rows of `ref`, in start order, as the bridge reads them. */
export const rowsOf = (place: Place, ref: SessionRef) =>
  new WeekendRepository(place.db, { rulesVersion: RULES }).sessionsOf(ref.weekendId).filter((row) => row.sessionUid === ref.sessionUid);

export type Call =
  | { kind: 'replayToEnd'; job: ReplayJob; priority: RebuildPriority }
  | { kind: 'ensureCurrent'; refs: SessionKey[]; priority: RebuildPriority | undefined };

/** The profile store as the round reads it (C62c). */
export type ProfilesFake = { snapshotFor: (slots: readonly SlotIdentity[], session: { sessionUid: string; weekendId: string; feedCar: number }) => ProfileSnapshot | null };

const ECHO_CAPTURE_JOB: Job<StrategyInput, StrategyOutput> = {
  kind: 'job',
  id: 'planning',
  reads: [],
  trigger: 'frame',
  prepare: () => {
    throw new Error('the planning runner builds the input itself (planningInputFrom)');
  },
  module: new URL('./planning-capture-stub-job.ts', import.meta.url),
};

/** Our cars' slots in the qualifying (19, 18) and in a qualifying of the other row (18, 19): every preview subscribed. */
const PREVIEW_CARS = [18, 19] as const;

/**
 * The planning module of `place` (see the header). `hold`: every `ensureCurrent` waits for it before the real service
 * runs (a stale pick's rebuild seen while it runs). `profiles`: the profile store; default one with nobody linked
 * (`null`, as without a store).
 */
export function planningOf(place: Place, o: { hold?: Promise<void>; profiles?: ProfilesFake } = {}) {
  const real = createRebuildService({ db: place.db, dataDir: place.dirs, rulesVersion: RULES, log: silent });
  cleanup.push(() => real.close());
  const calls: Call[] = [];
  const rebuild: Pick<RebuildService, 'ensureCurrent' | 'replayToEnd'> = {
    ensureCurrent: async (refs, opts) => {
      calls.push({ kind: 'ensureCurrent', refs: [...refs], priority: opts?.priority });
      if (o.hold !== undefined) await o.hold;
      return real.ensureCurrent(refs, opts);
    },
    replayToEnd: <T>(j: ReplayJob, priority: RebuildPriority): Promise<T> => {
      calls.push({ kind: 'replayToEnd', job: structuredClone(j), priority });
      return real.replayToEnd<T>(j, priority);
    },
  };
  const capture = mkdtempSync(join(tmpdir(), 'pitwall-round-job-'));
  process.env[CAPTURE_ENV] = capture;
  cleanup.push(() => {
    if (process.env[CAPTURE_ENV] === capture) Reflect.deleteProperty(process.env, CAPTURE_ENV);
  });
  // the hub's clock stands still: the tests read `plans.prepared` (`maxHz: Infinity`) and the job's inputs
  const hub = new TopicHub({ now: () => 0 });
  const got: ServerMessage[] = [];
  hub.addClient('c', { send: (m) => got.push(structuredClone(m)), bufferedAmount: () => 0 });
  const subscribe = (id: string, topic: TopicName, params: object): void => hub.subscribe({ clientId: 'c', id, topic, params, feedId: F });
  subscribe('prepared', 'plans.prepared', {});
  for (const car of PREVIEW_CARS) subscribe(`preview:${car}`, 'plans.preview', { carId: car });
  const store = new SavedPlanStore(place.dirs.root, silent);
  const lastChoice = createLastChoiceStore(place.dirs.root, silent);
  const runner = createPlanningRunner({
    rebuild,
    jobs: { job: ECHO_CAPTURE_JOB, workerLimit: new WorkerLimit(2) },
    hub,
    store,
    lastChoice,
    sessions: new WeekendRepository(place.db, { rulesVersion: RULES }),
    profiles: o.profiles ?? { snapshotFor: () => null },
    log: silent,
  });
  const planning = new Planning({
    runner,
    store,
    lastChoice,
    suggestedLaps: (trackId: TrackId, _format: RaceFormat) => (trackId === TRACK ? known(SUGGESTED, 0) : unknown('notReceived')),
    log: silent,
  });
  cleanup.push(() => planning.close());

  const values = <T>(id: string): T[] =>
    got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === id && 'value' in m ? [m.value as T] : []));
  /** Every `plans.prepared` value, in order. */
  const prepared = (): PlanningRoundState[] => values<PlanningRoundState>('prepared');
  const preview = (car: number): Array<Computed<StrategyCar>> => values<Computed<StrategyCar>>(`preview:${car}`);
  /** The newest open round. */
  const round = (): Extract<PlanningRoundState, { open: true }> => {
    const last = prepared().at(-1);
    if (last?.open !== true) throw new Error(`no open round (${JSON.stringify(last)})`);
    return last;
  };
  const replays = (): Array<Extract<Call, { kind: 'replayToEnd' }>> => calls.filter((c): c is Extract<Call, { kind: 'replayToEnd' }> => c.kind === 'replayToEnd');
  const ensured = (): Array<Extract<Call, { kind: 'ensureCurrent' }>> => calls.filter((c): c is Extract<Call, { kind: 'ensureCurrent' }> => c.kind === 'ensureCurrent');
  /** Every input the planning job was handed, in run order, as the worker received it (structured-cloned). */
  const jobInputs = (): StrategyInput[] =>
    readdirSync(capture).filter((f) => f.endsWith('.bin')).sort().map((f) => deserialize(readFileSync(join(capture, f))) as StrategyInput);
  const apply = (action: PlanningAction): ActionOutcome => planning.apply(action);
  /** `plans.round.open` on feed F (C73): the qualifying, the team (default ours), the practice (default none), the race when given. */
  const open = (o2: { qualifying: SessionRef; team?: number; practice?: SessionRef[]; race?: RoundRace }): ActionOutcome =>
    apply({ kind: 'plans.round.open', feedId: F, qualifying: o2.qualifying, team: o2.team ?? TEAM, practice: o2.practice ?? [], ...(o2.race !== undefined && { race: o2.race }) } as Extract<UiAction, { kind: 'plans.round.open' }>);
  /** `plans.race.set` on feed F. */
  const setRace = (race: Extract<UiAction, { kind: 'plans.race.set' }>['race']): ActionOutcome => apply({ kind: 'plans.race.set', feedId: F, race });
  /** Waits until the round is open, rebuilt, its job done, and the job has been handed at least `runs` inputs. */
  const settled = async (runs: number): Promise<Extract<PlanningRoundState, { open: true }>> => {
    await vi.waitFor(() => {
      expect(jobInputs().length).toBeGreaterThanOrEqual(runs);
      expect(prepared().at(-1)).toMatchObject({ open: true, running: false, rebuilding: false });
    }, { timeout: 60_000 });
    return round();
  };
  return { planning, runner, store, lastChoice, calls, replays, ensured, prepared, preview, round, jobInputs, apply, open, setRace, settled };
}

/** The imported rows' samples of the round (known). */
export const samplesOf = (state: Extract<PlanningRoundState, { open: true }>): ForecastSample[] => {
  const { rows } = state.forecast;
  if (!rows.known) throw new Error(`the round's forecast rows are unknown (${rows.reason})`);
  return rows.value.map((row) => row.sample);
};

type Answer = { ok: true } | { ok: false; reason: string; message?: string };

/**
 * A live `serve` on the place's data dir and database, one manual source on feed F that receives nothing (no session),
 * the planning job the capture stand-in; a WebSocket client subscribed to `plans.prepared` of feed F.
 */
export async function serveBridge(place: Place) {
  const root = place.dirs.root;
  const uiDir = join(root, 'ui');
  mkdirSync(uiDir, { recursive: true });
  const source = new ManualSource(F);
  const out: string[] = [];
  const abort = new AbortController();
  // `serve` closes the database it is handed: its own connection to the place's file
  const db = openDatabase(join(root, 'live.db'));
  const done = serve({
    sources: [{ source, feed: { kind: 'udp' as const, label: source.feedId } }],
    wsPort: 0,
    dumpsDir: join(root, 'dumps'),
    uiDir,
    storage: { db, recordingsDir: place.dirs.recordings, rulesVersion: RULES },
    planningJob: ECHO_CAPTURE_JOB,
    io: { out: (line) => out.push(line), err: () => {}, env: {}, signal: abort.signal },
  });
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    await done;
  };
  cleanup.push(stop);
  await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 15_000 });
  const port = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))![1];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: ServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d)) as ServerMessage));
  await new Promise((r) => ws.once('open', r));
  cleanup.push(() => ws.terminate());
  ws.send(JSON.stringify({ type: 'subscribe', id: 'prepared', topic: 'plans.prepared', params: {}, feedId: F }));
  const prepared = (): PlanningRoundState[] =>
    got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === 'prepared' && 'value' in m ? [m.value as PlanningRoundState] : []));
  let actions = 0;
  const send = async (action: Record<string, unknown>): Promise<Answer> => {
    const id = `a${actions++}`;
    ws.send(JSON.stringify({ type: 'uiAction', id, action }));
    return vi.waitFor(() => {
      const answer = got.find((m) => m.type === 'actionResult' && m.id === id);
      if (answer === undefined) throw new Error(`no answer to ${id}`);
      const { type: _type, id: _id, ...rest } = answer as unknown as { type: string; id: string } & Answer;
      return rest as Answer;
    });
  };
  return { prepared, send, stop };
}
