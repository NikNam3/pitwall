// SP4.3e Task 7b, rows (a) and (b) (C51, C54, C62d; spec §4.0 idea 3, §4.3 "PlanningRunner"): the planning round is a
// function of a qualifying recording, a practice basis and the race assumptions. `open` replays the qualifying's
// recording (its first stored row of the round's team, SP4.3f Task 3) to its end through the rebuild service's
// `replayToEnd` (priority `planning`, off the thread that applies frames), with the practice basis (of the team, made
// current first with `ensureCurrent`) in place of the recording's basis sidecar, builds the as-of view and runs the
// planning job on it; it publishes `plans.preview` per our car and `plans.prepared` as `PlanningRoundState`. No feed
// pipeline is involved: the runner is made without one. `setRace` re-runs the round on new race assumptions; `close`
// closes it and drops a running job. Ported to SP4.3f Task 3: the team is the spec's (`RoundSpec.team`), no feed seat.
//
// Seams this file assumes (the implement phase adds them; the imports fail until then):
//  - `apps/bridge/src/planning/runner.ts`: `createPlanningRunner(o)` with `o = { rebuild, jobs: { job, workerLimit },
//    hub, store, lastChoice, sessions, profiles, log }`: `rebuild` the `RebuildService`; `jobs.job` the planning job (its
//    `prepare` never called), `jobs.workerLimit` the bridge's shared `WorkerLimit`; `store` the `SavedPlanStore`;
//    `lastChoice` the `LastChoiceStore`; `sessions` the `WeekendRepository` it resolves a `SessionRef` of the spec's
//    team with (the first stored row of that uid and weekend whose player car has the team, its recording);
//    `profiles` the profile store (`snapshotFor`; here one that has none, `null`); `open(spec)` takes
//    `{ feedId, qualifying, team, practice, race? }`;
//  - `apps/bridge/src/storage/rebuild-service.ts` (Task 7d): `createRebuildService({ db, dataDir, rulesVersion, log })`;
//    the tests spy on it: every `replayToEnd` and `ensureCurrent` call is recorded, then run by the real service, so
//    the replay runs in its worker. What `replayToEnd` resolves to is between the worker and the runner;
//  - `apps/bridge/src/planning/saved-plans.ts`: `new SavedPlanStore(dataDir, log)`;
//  - `apps/bridge/src/pipeline/last-choice.ts` (Task 7a-1): `createLastChoiceStore(dataDir, log)`.
//
// The planning job is the echo stand-in of `planning-stub-job.ts` (per our car one row per prepared slot): these tests
// check the replay path and the topics, not the model. Every data dir and database is a temporary one (C84); the
// qualifying is the committed segment `qualifying-texas-2026-end-dr` (Texas, track 15; the DR feed's player car 1, race
// number 2, team 0; the teammate car 0, race number 64); the practices are builder sessions stored as recordings.
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Computed, PlanningRoundState, ServerMessage, TopicName } from '@pitwall/contracts';
import { carId, feedId, IMPORTED, type BasisSidecar, type RaceAssumptions, type SessionRef, type StrategyCar, type StrategyOutput } from '@pitwall/domain';
import type { StrategyInput } from '@pitwall/analysis';
import type { Job } from '@pitwall/engine/readers';
import { processRecording } from '../../src/cli/process-recording.ts';
import { loadFeatureConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { WorkerLimit } from '../../src/jobs/worker-limit.ts';
import { createLogger } from '../../src/log.ts';
import { createLastChoiceStore } from '../../src/pipeline/last-choice.ts';
import { createPlanningRunner } from '../../src/planning/runner.ts';
import { SavedPlanStore } from '../../src/planning/saved-plans.ts';
import { dataDir, type DataDir } from '../../src/storage/data-dir.ts';
import { openDatabase, type Db, type SessionKey } from '../../src/storage/db.ts';
import { createRebuildService } from '../../src/storage/rebuild-service.ts';
import type { RebuildPriority, RebuildService, ReplayJob } from '../../src/storage/rebuild-service-types.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { writeSynthetic } from '../../../../test-support/recordings/index.ts';
import { SLOW_MS } from './planning-slow-stub-job.ts';

const RULES = 'rules-of-this-bridge';
const F = feedId('udp-20777');
const QUALIFYING_SEGMENT = 'qualifying-texas-2026-end-dr.pwrec.gz';
const QUALIFYING: SessionRef = { sessionUid: '12101553556244014932', weekendId: '548397152' };
const TRACK = 15;
/** The DR feed's team: its player car 1 (race number 2) and the teammate car 0 (race number 64) drive for team 0. */
const TEAM = 0;
const OUR_CARS = [1, 0] as const;

const silent = createLogger({ level: 'silent' });

const job = (module: string): Job<StrategyInput, StrategyOutput> => ({
  kind: 'job',
  id: 'planning',
  reads: [],
  trigger: 'frame',
  prepare: () => {
    throw new Error('the planning runner builds the input itself (planningInputFrom)');
  },
  module: new URL(module, import.meta.url),
});
const ECHO_JOB = job('./planning-stub-job.ts');
const SLOW_JOB = job('./planning-slow-stub-job.ts');

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

/** A fresh data dir (C84) and its database. */
function newPlace(): { dirs: DataDir; db: Db } {
  const dirs = dataDir({ PITWALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pitwall-planning-runner-')) });
  const db = openDatabase(dirs.dbPath);
  cleanup.push(() => db.close());
  return { dirs, db };
}

/** `file` processed into the place's storage under this bridge's rules version; its stored key. */
async function store(place: { dirs: DataDir; db: Db }, file: string): Promise<SessionKey> {
  await processRecording(file, place.db, silent, new AbortController().signal, loadFeatureConfig(place.dirs.root, FEATURES), RULES);
  const rows = place.db.prepare('SELECT session_uid, weekend_id, player_car FROM sessions WHERE pwrec_path = ?').all(file) as Array<{ session_uid: string; weekend_id: string; player_car: number }>;
  if (rows.length !== 1) throw new Error(`${file}: expected one stored session, got ${rows.length}`);
  return { sessionUid: rows[0]!.session_uid, weekendId: rows[0]!.weekend_id, playerCar: rows[0]!.player_car } as SessionKey;
}

/** The committed qualifying segment, copied into the place's recordings and stored there. */
async function storeQualifying(place: { dirs: DataDir; db: Db }): Promise<{ key: SessionKey; file: string }> {
  const file = join(place.dirs.recordings, basename(QUALIFYING_SEGMENT));
  copyFileSync(segmentPath(QUALIFYING_SEGMENT), file);
  return { key: await store(place, file), file };
}

/**
 * A builder practice on the track (session type 1) of four cars, team 0's #2 the player in slot 3 (#64 in slot 2),
 * written as a recording into the place's recordings and stored; its ref and key.
 */
async function storePractice(place: { dirs: DataDir; db: Db }, uid: bigint, weekend: number): Promise<{ ref: SessionRef; key: SessionKey }> {
  const file = join(place.dirs.recordings, `practice-${uid}.pwrec.gz`);
  await writeSynthetic(file, {
    sessionUid: uid,
    weekendId: weekend,
    trackId: TRACK,
    kind: 'practice',
    player: 3,
    cars: [{ teamId: 5, raceNumber: 10 }, { teamId: 5, raceNumber: 11 }, { teamId: TEAM, raceNumber: 64 }, { teamId: TEAM, raceNumber: 2 }],
  });
  const key = await store(place, file);
  return { ref: { sessionUid: key.sessionUid, weekendId: key.weekendId }, key };
}

type Call = { kind: 'replayToEnd'; job: ReplayJob; priority: RebuildPriority } | { kind: 'ensureCurrent'; refs: SessionKey[]; priority: RebuildPriority | undefined };

/** The real rebuild service of the place, every call recorded first. */
function spiedRebuild(place: { dirs: DataDir; db: Db }): { rebuild: RebuildService; calls: Call[] } {
  const real = createRebuildService({ db: place.db, dataDir: place.dirs, rulesVersion: RULES, log: silent });
  cleanup.push(() => real.close());
  const calls: Call[] = [];
  const rebuild: RebuildService = {
    ensureCurrent: (refs, opts) => {
      calls.push({ kind: 'ensureCurrent', refs: [...refs], priority: opts?.priority });
      return real.ensureCurrent(refs, opts);
    },
    replayToEnd: <T>(j: ReplayJob, priority: RebuildPriority): Promise<T> => {
      calls.push({ kind: 'replayToEnd', job: structuredClone(j), priority });
      return real.replayToEnd<T>(j, priority);
    },
    close: () => real.close(),
  };
  return { rebuild, calls };
}

/** A runner over the place with a hub client subscribed to `plans.prepared` and our cars' `plans.preview`. */
function runnerOf(place: { dirs: DataDir; db: Db }, o: { planningJob?: Job<StrategyInput, StrategyOutput> } = {}) {
  const { rebuild, calls } = spiedRebuild(place);
  // the hub's clock: `plans.preview` has `maxHz: 1`, so a test that waits for a later preview moves it on and flushes
  let clock = 0;
  const hub = new TopicHub({ now: () => clock });
  const advance = (ms: number): void => {
    clock += ms;
    hub.tick();
  };
  const got: ServerMessage[] = [];
  hub.addClient('c', { send: (m) => got.push(structuredClone(m)), bufferedAmount: () => 0 });
  const subscribe = (id: string, topic: TopicName, params: object) => hub.subscribe({ clientId: 'c', id, topic, params, feedId: F });
  subscribe('prepared', 'plans.prepared', {});
  for (const car of OUR_CARS) subscribe(`preview:${car}`, 'plans.preview', { carId: car });
  const runner = createPlanningRunner({
    rebuild,
    jobs: { job: o.planningJob ?? ECHO_JOB, workerLimit: new WorkerLimit(2) },
    hub,
    store: new SavedPlanStore(place.dirs.root, silent),
    lastChoice: createLastChoiceStore(place.dirs.root, silent),
    sessions: new WeekendRepository(place.db, { rulesVersion: RULES }),
    profiles: { snapshotFor: () => null },
    log: silent,
  });
  cleanup.push(() => runner.close(F));
  const values = <T>(id: string): T[] =>
    got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === id && 'value' in m ? [m.value as T] : []));
  const prepared = (): PlanningRoundState[] => values<PlanningRoundState>('prepared');
  const preview = (car: number): Array<Computed<StrategyCar>> => values<Computed<StrategyCar>>(`preview:${car}`);
  const replays = (): Array<Extract<Call, { kind: 'replayToEnd' }>> => calls.filter((c): c is Extract<Call, { kind: 'replayToEnd' }> => c.kind === 'replayToEnd');
  return { runner, calls, replays, prepared, preview, advance };
}

const FRESH_56: RaceAssumptions = { laps: 56, sets: 'fresh', conditions: IMPORTED };

describe('the planning runner (Task 7b rows a, b; C51, C54, C62d)', { timeout: 180_000 }, () => {
  it('(a) open on a qualifying segment with race { laps: 56, sets: fresh } publishes plans.preview for both our cars; the replay ran through replayToEnd with priority planning', async () => {
    const place = newPlace();
    const qualifying = await storeQualifying(place);
    const r = runnerOf(place);
    await r.runner.open({ feedId: F, qualifying: QUALIFYING, team: TEAM, practice: [], race: FRESH_56 });

    // one replay, in the rebuild service's worker, of the qualifying's recording of the team, with the race assumptions
    // and the round's profile snapshot (none here)
    expect(r.replays()).toEqual([{ kind: 'replayToEnd', job: { pwrecPath: qualifying.file, basisOverride: [], laps: 56, sets: 'fresh', conditions: IMPORTED, profiles: null }, priority: 'planning' }]);
    // the planning job's result per our car
    for (const car of OUR_CARS) {
      await vi.waitFor(() => expect(r.preview(car).length, `car ${car}`).toBeGreaterThan(0), { timeout: 60_000 });
      expect(r.preview(car).at(-1)!.value.known, `car ${car}`).toBe(true);
    }
    // the round's state (C54): the qualifying, its practice basis, the race assumptions, our cars by slot with their race numbers
    await vi.waitFor(() => expect(r.prepared().at(-1)).toMatchObject({ open: true, running: false }));
    const stored = place.db.prepare('SELECT player_car, teammate_car, started_at FROM sessions WHERE session_uid = ?').get(QUALIFYING.sessionUid) as { player_car: number; teammate_car: number | null; started_at: string };
    expect(r.prepared().at(-1)).toEqual<PlanningRoundState>({
      open: true,
      qualifying: QUALIFYING,
      practice: [],
      race: FRESH_56,
      team: TEAM,
      trackId: TRACK,
      playerCar: carId(stored.player_car),
      teammateCar: stored.teammate_car === null ? null : carId(stored.teammate_car),
      // the rows are the segment's race samples, if it holds any (no test asserts a fact of a recording, C84)
      forecast: { source: { ref: QUALIFYING, startedAt: stored.started_at }, rows: expect.objectContaining({ known: expect.any(Boolean) }) },
      rebuilding: false,
      lastSaved: null,
      cars: {
        1: { raceNumber: 2, slots: {}, active: null },
        0: { raceNumber: 64, slots: {}, active: null },
      },
      running: false,
      saved: [],
    });
  });

  it('(b) the practice override: the round\'s basis is the given practice of the team, not the recording\'s sidecar basis', async () => {
    const place = newPlace();
    const qualifying = await storeQualifying(place);
    const given = await storePractice(place, 501n, 4001);
    const other = await storePractice(place, 502n, 4002);
    // the qualifying's recording names the other practice as its basis (its sidecar, C62)
    const sidecar: BasisSidecar = { start: { practice: [other.ref], qualifying: null }, preselected: { practice: [other.ref], qualifying: null } };
    writeFileSync(`${qualifying.file}.basis.json`, JSON.stringify(sidecar));

    const r = runnerOf(place);
    await r.runner.open({ feedId: F, qualifying: QUALIFYING, team: TEAM, practice: [given.ref], race: FRESH_56 });

    // the given practice, as the team's stored session (its player car the team's), made current first (C61), then
    // replayed with in place of the sidecar's basis
    const ensured = r.calls.findIndex((c) => c.kind === 'ensureCurrent' && c.refs.some((k) => k.sessionUid === given.key.sessionUid));
    const replayed = r.calls.findIndex((c) => c.kind === 'replayToEnd');
    expect(ensured, 'the practice made current').toBeGreaterThanOrEqual(0);
    expect(replayed).toBeGreaterThan(ensured);
    expect(r.replays()).toHaveLength(1);
    expect(r.replays()[0]!.job.basisOverride).toEqual([given.key]);
    expect(r.replays()[0]!.job.basisOverride).not.toContainEqual(other.key);
    await vi.waitFor(() => expect(r.preview(1).length).toBeGreaterThan(0), { timeout: 60_000 });
    expect(r.prepared().at(-1)).toMatchObject({ open: true, practice: [given.ref], qualifying: QUALIFYING });
  });

  it('setRace re-runs the round on the new race assumptions', async () => {
    const place = newPlace();
    const qualifying = await storeQualifying(place);
    const r = runnerOf(place);
    await r.runner.open({ feedId: F, qualifying: QUALIFYING, team: TEAM, practice: [], race: { laps: 56, sets: 'carried', conditions: IMPORTED } });
    await vi.waitFor(() => expect(r.preview(1).length).toBeGreaterThan(0), { timeout: 60_000 });
    const before = r.preview(1).length;

    r.runner.setRace(F, FRESH_56);
    await vi.waitFor(() => expect(r.prepared().at(-1)).toMatchObject({ open: true, race: FRESH_56 }));
    await vi.waitFor(() => expect(r.replays().at(-1)?.job).toEqual({ pwrecPath: qualifying.file, basisOverride: [], laps: 56, sets: 'fresh', conditions: IMPORTED, profiles: null }), { timeout: 60_000 });
    expect(r.replays().at(-1)?.priority).toBe('planning');
    // past the preview's throttle interval (maxHz 1): the newest preview goes out on the hub's tick
    await vi.waitFor(
      () => {
        r.advance(1000);
        expect(r.preview(1).length).toBeGreaterThan(before);
      },
      { timeout: 60_000 },
    );
  });

  it('close closes the round: plans.prepared open false, a running job\'s result never published', async () => {
    const place = newPlace();
    await storeQualifying(place);
    const r = runnerOf(place, { planningJob: SLOW_JOB });
    await r.runner.open({ feedId: F, qualifying: QUALIFYING, team: TEAM, practice: [], race: FRESH_56 });
    await vi.waitFor(() => expect(r.prepared().at(-1)).toMatchObject({ open: true, running: true }), { timeout: 60_000 });

    r.runner.close(F);
    // closed: the team's saved plans on the track still listed, none in this data dir (ruling R15)
    await vi.waitFor(() => expect(r.prepared().at(-1)).toEqual({ open: false, saved: [] }));
    // past the time the job would have taken: its result is never published
    await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 2000));
    for (const car of OUR_CARS) expect(r.preview(car), `car ${car}`).toEqual([]);
    expect(r.prepared().at(-1)).toEqual({ open: false, saved: [] });
  });

  it('(F3) save without a team last choice writes only the plan: no basis kind is confirmed by a save (C62)', async () => {
    const place = newPlace();
    await storeQualifying(place);
    const practice = await storePractice(place, 501n, 9001);
    const r = runnerOf(place);
    await r.runner.open({ feedId: F, qualifying: QUALIFYING, team: TEAM, practice: [practice.ref], race: FRESH_56 });
    await vi.waitFor(() => expect(r.prepared().at(-1)).toMatchObject({ open: true }), { timeout: 60_000 });
    expect(r.runner.save(F, { name: 'morning' })).toEqual({ ok: true });
    const [plan] = new SavedPlanStore(place.dirs.root, silent).list(TEAM, TRACK);
    const choice = createLastChoiceStore(place.dirs.root, silent).read(TEAM, TRACK);
    // the team's last saved plan on the track (C62d), and no basis the user never confirmed: neither kind is written
    expect(choice?.plan).toEqual({ id: plan!.id, at: plan!.savedAt });
    expect(choice?.basis.practice).toBeUndefined();
    expect(choice?.basis.qualifying).toBeUndefined();
  });

  it('(F3) save with a team last choice keeps its basis kinds as they were', async () => {
    const place = newPlace();
    await storeQualifying(place);
    const confirmedAt = '2026-11-18T09:40:00.000Z';
    const last = createLastChoiceStore(place.dirs.root, silent);
    last.write(TEAM, { trackId: TRACK, basis: { qualifying: { ref: QUALIFYING, at: confirmedAt } }, plan: { id: null, at: confirmedAt } });
    const r = runnerOf(place);
    await r.runner.open({ feedId: F, qualifying: QUALIFYING, team: TEAM, practice: [], race: FRESH_56 });
    await vi.waitFor(() => expect(r.prepared().at(-1)).toMatchObject({ open: true }), { timeout: 60_000 });
    expect(r.runner.save(F, { name: 'morning' })).toEqual({ ok: true });
    const choice = last.read(TEAM, TRACK);
    expect(choice?.basis).toEqual({ qualifying: { ref: QUALIFYING, at: confirmedAt } });
    expect(choice?.plan.id).toEqual(expect.any(String));
  });

  it('a qualifying not stored for the team opens no round (C3: no throw)', async () => {
    const place = newPlace();
    const r = runnerOf(place);
    await r.runner.open({ feedId: F, qualifying: QUALIFYING, team: TEAM, practice: [], race: FRESH_56 });
    expect(r.replays()).toEqual([]);
    expect(r.prepared().filter((v) => v.open)).toEqual([]);
  });
});
