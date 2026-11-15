// SP4.3c Task 10 (C59 as changed; spec §5.5): a session's recording continues across bridge restarts. A live session
// whose key (session uid, weekend id, player car) is stored with a recording continues that recording: the bridge trims it
// to its last whole record, replays it into the new run with its sidecars (config, priors, track, realism; decisions at
// their record index), buffers the packets that arrive meanwhile, writes them after a resume record, applies them and
// goes live. The continued run equals one run that never stopped (C38): its projection, its topics, the topic stream of
// its recording, and `pitwall reprocess` of it. Storage appends only what lies beyond each stored list (C24); a changed
// rules version makes the replay a rebuild that replaces the log whole (C61). Decisions and calibration edits that arrive
// during the restore are queued in arrival order and handed to the run at its first live frame, placed in the decisions
// sidecar at that record index, as for a feed that joins the team later (C76, supervisor ruling); none is rejected.
//
// Every run here is a live run of one committed segment (C84) split at a Session packet: the first run gets the first
// part and is stopped (a clean bridge stop), the restarted run gets the rest, with receive times on another origin (a new
// process's monotonic clock) and a wall clock at which the gap since the last record is the segment's own. Data dirs,
// databases and recordings are temporary directories the tests make.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import { carId, known, trackDataOf, unknown, type DecisionRecord, type FeedId, type PriorsEntries } from '@pitwall/domain';
import { defineConfig, type EngineView, type QuickCalculator } from '@pitwall/engine';
import { PacketId, peekHeader } from '@pitwall/protocol';
import { zandvoortTrackFile } from '../../../../test-support/track.ts';
import { main } from '../../src/cli/pitwall.ts';
import type { CliIo } from '../../src/cli/io.ts';
import { loadFeatureConfig, sessionConfigPath, type FeatureConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../../src/input/packet-source.ts';
import { createLogger } from '../../src/log.ts';
import { decisionsSidecarPath, priorsSidecarPath } from '../../src/pipeline/decision-sidecars.ts';
import { FeedPipeline, type DecisionResult, type FeedPipelineOptions } from '../../src/pipeline/feed-pipeline.ts';
import type { PlanDecision } from '../../src/pipeline/team-feeds.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { openDatabase, type Db, type SessionKey } from '../../src/storage/db.ts';
import { trackSidecarPath } from '../../src/track-files/load.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';
import { fakeCalibration, type FakeSet } from '../helpers/fake-calibration.ts';
import { HookedSource } from '../helpers/hooked-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { rawRecords } from '../pwrec/helpers.ts';
import { factRows, forbidFactRewrites } from '../storage/records.ts';

const F = 'live' as FeedId;
const SEGMENT = segmentPath('race-zandvoort-pit-exit.pwrec.gz');
const ZANDVOORT = 26;
const tmp = () => mkdtempSync(join(tmpdir(), 'restart-'));
/** The wall clock of the first run's session start. */
const W0 = Date.UTC(2026, 10, 15, 12, 0, 0);
/** The restarted process's monotonic clock starts elsewhere: its receive times are on another origin. */
const RESTART_ORIGIN_MS = 7_000_000;

/** The segment's datagrams as they were received, and the index of the Session packet it is split at. */
type Segment = { packets: PreparedPacket[]; split: number; first: PreparedPacket[]; rest: PreparedPacket[]; originMs: number };

const isSession = (p: PreparedPacket): boolean => {
  const header = peekHeader(p.bytes);
  return header !== undefined && header.packetId === PacketId.session && header.sessionUid !== 0n;
};

async function loadSegment(): Promise<Segment> {
  const packets: PreparedPacket[] = [];
  for await (const r of readPwrec(SEGMENT)) packets.push({ bytes: r.payload, receivedAtMs: r.t });
  const split = packets.findIndex((p, i) => i >= Math.floor(packets.length / 2) && isSession(p));
  expect(split).toBeGreaterThan(0);
  // A live session file counts its record times from its first Session packet (`SessionFile.originMs`).
  const originMs = packets.find(isSession)!.receivedAtMs;
  return { packets, split, first: packets.slice(0, split), rest: packets.slice(split), originMs };
}

/** The restarted run's packets: the rest of the segment on the new process's receive clock. */
const restarted = (s: Segment): PreparedPacket[] =>
  s.rest.map((p) => ({ ...p, receivedAtMs: p.receivedAtMs - s.rest[0]!.receivedAtMs + RESTART_ORIGIN_MS }));

/**
 * The wall clock of the restarted process: the wall time of the first run's last record plus the segment's own gap to
 * the first packet after the split, so the resume record's `t` is that packet's record time in a run that never stopped.
 */
const restartWall = (s: Segment): number => W0 + (s.rest[0]!.receivedAtMs - s.originMs);

/** The topics a client of every run watches: core history, situation and session topics, and the insights. */
const WATCHED: TopicName[] = ['laps', 'events', 'stints', 'pitStops', 'insights', 'session.info', 'situation.carLocation', 'situation.sessionPhaseRace', 'situation.carActivityRace'];

/** A hub whose client keeps the last value of each state topic and every entry of each append topic, as a window has them. */
function watchingHub(topics: readonly TopicName[]) {
  let nowMs = 0;
  const hub = new TopicHub({ now: () => (nowMs += 1000) });
  const values = new Map<string, unknown>(), lists = new Map<string, unknown[]>();
  const send = (m: ServerMessage) => {
    if (m.type === 'snapshot') { if (m.entries) lists.set(m.id, [...m.entries]); else values.set(m.id, m.value); }
    else if (m.type === 'update') values.set(m.id, m.value);
    else if (m.type === 'append') lists.set(m.id, [...(lists.get(m.id) ?? []), ...m.entries]);
  };
  hub.addClient('window', { send, bufferedAmount: () => 0 });
  for (const topic of topics) hub.subscribe({ clientId: 'window', id: topic, topic, params: {}, feedId: F });
  const seen = () => ({ values: Object.fromEntries(values), lists: Object.fromEntries(lists) });
  return { hub, seen, value: (topic: TopicName) => values.get(topic) };
}

/** What a probe unit saw on each frame: the run's config, priors and track (C39), all fixed for the session. */
type Seen = { config: EngineView['config']; priors: EngineView['priors']; track: EngineView['track'] };

/** A unit that keeps `view.config`, `view.priors` and `view.track` each frame; it reads `feed`, so it runs every frame. */
function viewProbe(): { feature: Feature; seen: Seen[] } {
  const seen: Seen[] = [];
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.restart-probe',
    reads: ['feed', 'decisions'],
    cadence: 'frame',
    compute: (view) => {
      seen.push({ config: view.config, priors: view.priors, track: view.track });
      return seen.length;
    },
  };
  return { feature: defineFeature({ name: 'restart-probe', calculators: [calc], topics: [] }), seen };
}

const threshold = defineConfig('test.threshold', { limit: 1_000_000 });

/** One live run's place: its database and recordings dir (shared by a first run and its restart). */
type Place = { db: Db; recordingsDir: string };
const newPlace = (): Place => ({ db: openDatabase(join(tmp(), 'live.db')), recordingsDir: tmp() });

type LiveOptions = {
  place: Place;
  wallMs: number;
  features?: Feature[];
  topics?: readonly TopicName[];
  rulesVersion?: string;
  extra?: Partial<FeedPipelineOptions>;
};

/** A live pipeline over `source`; error-level log lines are kept (the pipeline logs bugs instead of throwing them). */
function livePipeline(source: PacketSource, o: LiveOptions) {
  const watching = watchingHub(o.topics ?? []);
  const errors: string[] = [];
  const log = createLogger({ level: 'error', destination: new Writable({ write(c, _e, cb) { errors.push(String(c)); cb(); } }) });
  const pipeline = new FeedPipeline({
    feedId: F, source, hub: watching.hub, features: o.features ?? [], log, wallClock: () => o.wallMs,
    storage: { db: o.place.db, rulesVersion: o.rulesVersion ?? 'unversioned', recordingsDir: o.place.recordingsDir },
    ...o.extra,
  });
  return { pipeline, errors, ...watching };
}

/** The first run: the first part pushed as it arrives, then the bridge stops. `between`: called after packet `i`. */
async function firstRun(s: Segment, o: LiveOptions, between?: (i: number, pipeline: FeedPipeline) => void) {
  const source = new ManualSource(F);
  const run = livePipeline(source, o);
  run.pipeline.start();
  s.first.forEach((p, i) => { source.push(p.bytes, p.receivedAtMs); between?.(i, run.pipeline); });
  await run.pipeline.stop();
  return run;
}

/** The restarted run: a new process (pipeline, hub, wall clock) on the same place, given `source` (the rest). */
async function restartRun(s: Segment, o: Omit<LiveOptions, 'wallMs'>, source: PacketSource = new ArraySource(F, restarted(s))) {
  const run = livePipeline(source, { ...o, wallMs: restartWall(s) });
  run.pipeline.start();
  await run.pipeline.done;
  return run;
}

/** One run that never stopped: the whole segment, in a place of its own. */
async function oneRun(s: Segment, o: Omit<LiveOptions, 'wallMs' | 'place'> = {}) {
  const place = newPlace();
  const run = livePipeline(new ArraySource(F, s.packets), { ...o, place, wallMs: W0 });
  run.pipeline.start();
  await run.pipeline.done;
  return { ...run, place };
}

const recordingsOf = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz')).map((name) => join(dir, name));
const onlyRecording = (place: Place): string => {
  const files = recordingsOf(place.recordingsDir);
  expect(files).toHaveLength(1);
  return files[0]!;
};

type SessionRowSql = { session_uid: string; weekend_id: string; player_car: number; started_at: string; pwrec_path: string | null; rules_version: string; complete: number };
const sessionRows = (db: Db): SessionRowSql[] =>
  db.prepare('SELECT session_uid, weekend_id, player_car, started_at, pwrec_path, rules_version, complete FROM sessions ORDER BY session_uid').all() as SessionRowSql[];
const onlyKey = (db: Db): SessionKey => {
  const rows = sessionRows(db);
  expect(rows).toHaveLength(1);
  return { sessionUid: rows[0]!.session_uid, weekendId: rows[0]!.weekend_id, playerCar: rows[0]!.player_car } as SessionKey;
};
const datagrams = async (path: string) => {
  const out: Array<{ t: number; payload: number[] }> = [];
  for await (const r of readPwrec(path)) out.push({ t: r.t, payload: [...r.payload] });
  return out;
};

let segment: Segment;
beforeAll(async () => {
  segment = await loadSegment();
});

describe('a live session continues its recording across a bridge restart (C38, C59)', { timeout: 180_000 }, () => {
  it('a session segment split at frame N into a first run and a restarted run gives the same projection and topic stream as one run', async () => {
    const whole = await oneRun(segment, { features: FEATURES, topics: WATCHED });
    const place = newPlace();
    await firstRun(segment, { place, wallMs: W0, features: FEATURES });
    const again = await restartRun(segment, { place, features: FEATURES, topics: WATCHED });
    expect(again.errors).toEqual([]);
    // the restarted window ends where the window of one run ends: every core list, situation and session topic
    expect(again.seen()).toEqual(whole.seen());
    // one recording, continued; its topic stream is that of one run's recording
    const continued = onlyRecording(place);
    expect(await topicStreamHash(continued)).toBe(await topicStreamHash(onlyRecording(whole.place)));
    // the stored projection is one run's
    expect(factRows(place.db, onlyKey(place.db))).toEqual(factRows(whole.place.db, onlyKey(whole.place.db)));
  });

  it('packets arriving during the replay are written after the resume record and applied after it, in order', async () => {
    const whole = await oneRun(segment);
    const place = newPlace();
    await firstRun(segment, { place, wallMs: W0 });
    const firstPart = await datagrams(onlyRecording(place));
    // the rest arrives in three bursts: at once (during the replay), a moment later, and after a pause
    const rest = restarted(segment);
    const bursts = [rest.slice(0, 50), rest.slice(50, 400), rest.slice(400)];
    const source = new StagedSource(F, bursts, [0, 20, 300]);
    const again = await restartRun(segment, { place }, source);
    expect(again.errors).toEqual([]);
    const file = onlyRecording(place);
    // the file: the first part's datagrams, the resume record (at the restart's wall time), then every packet of the
    // restart in arrival order; a stop's end record may stay mid-file, the file's last record is the end record
    const raw = rawRecords(file);
    const kinds = raw.map((r) => r.kind);
    expect(kinds.at(-1)).toBe(255);
    const body = raw.slice(0, -1).filter((r) => r.kind !== 255);
    expect(body.map((r) => r.kind)).toEqual([...firstPart.map(() => 0), 1, ...rest.map(() => 0)]);
    const resume = body[firstPart.length]!;
    expect(new TextDecoder().decode(resume.payload)).toBe(new Date(restartWall(segment)).toISOString());
    const ts = raw.map((r) => r.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    // the restart's packets are written byte for byte, in arrival order, on the file's time base: as one run wrote them
    // (times to 1 µs: the restart's wall time W0 + gap is a double near 1.7e12, so the gap reaches the file rounded)
    const [got, want] = [await datagrams(file), await datagrams(onlyRecording(whole.place))];
    expect(got.map((d) => d.payload)).toEqual(want.map((d) => d.payload));
    got.forEach((d, i) => expect(d.t).toBeCloseTo(want[i]!.t, 3));
    // and applied in that order: the stored log is one run's
    expect(factRows(place.db, onlyKey(place.db))).toEqual(factRows(whole.place.db, onlyKey(whole.place.db)));
  });

  it('the restarted run uses the first run\'s config and priors snapshot even when the data dir\'s config changed in between', async () => {
    const root = tmp();
    const probeFirst = viewProbe();
    const features = (probe: Feature): Feature[] => [defineFeature({ name: 'watcher', calculators: [], topics: [], config: [threshold] }), probe];
    writeFileSync(join(root, 'config.json'), JSON.stringify({ 'test.threshold': { limit: 5 } }));
    const firstConfig: FeatureConfig = loadFeatureConfig(root, features(probeFirst.feature));
    const entries = (ms: number): PriorsEntries => ({ 'pitLoss.ms.green': known(ms, 0) });
    const firstCal = fakeCalibration([
      { trackId: ZANDVOORT, id: 'dry', name: 'Dry', sources: 2, entries: entries(21_000) },
      { trackId: ZANDVOORT, id: 'wet', name: 'Wet', sources: 1, entries: entries(25_000) },
    ]);
    const wet = firstCal.snapshotNow(ZANDVOORT, 'wet');
    const place = newPlace();
    // the first run: config limit 5, realism off, the committed Zandvoort file, preselected `dry`, then `wet` picked
    await firstRun(segment, {
      place, wallMs: W0, features: features(probeFirst.feature),
      extra: { config: firstConfig, calibration: firstCal.store, realismNextSession: () => false, tracks: () => known(zandvoortTrackFile(), 0) },
    }, (i, pipeline) => { if (i === Math.floor(segment.split / 2)) expect(pipeline.commitDecision('wet')).toEqual({ ok: true }); });
    const file = onlyRecording(place);
    const sidecars = [sessionConfigPath(file), priorsSidecarPath(file), decisionsSidecarPath(file), trackSidecarPath(file)].map((path) => readFileSync(path, 'utf8'));
    const firstSeen = probeFirst.seen.at(-1)!;
    expect(firstSeen.priors).toEqual(known(wet, 0));

    // between the runs: config.json changes, realism is switched on, the store preselects another set, the track file is gone
    writeFileSync(join(root, 'config.json'), JSON.stringify({ 'test.threshold': { limit: 9 } }));
    const probe = viewProbe();
    const otherCal = fakeCalibration([{ trackId: ZANDVOORT, id: 'quali', name: 'Quali', sources: 1, entries: entries(30_000) }]);
    const again = await restartRun(segment, {
      place, features: features(probe.feature), topics: ['config.effective', 'calibration.active'],
      extra: { config: loadFeatureConfig(root, features(probe.feature)), calibration: otherCal.store, realismNextSession: () => true, tracks: () => unknown('notApplicable') },
    });
    expect(again.errors).toEqual([]);
    const last = probe.seen.at(-1)!;
    // the first run's config (realism included), its picked snapshot (the decision replayed at its record index), its track
    expect(last.config).toEqual(firstSeen.config);
    expect(last.config['test.threshold']).toEqual({ limit: 5 });
    expect(last.config['realism']?.['enabled']).toBe(false);
    expect(last.priors).toEqual(known(wet, 0));
    expect(last.track).toEqual(known(trackDataOf(zandvoortTrackFile()), 0));
    expect(otherCal.preselect).not.toHaveBeenCalled();
    expect(again.value('config.effective')).toMatchObject({ values: { 'test.threshold': { limit: 5 } } });
    expect(again.value('calibration.active')).toMatchObject({ known: true, value: { setId: 'wet', snapshot: wet.fingerprint, picked: true } });
    // the sidecars are the first run's, unchanged
    expect([sessionConfigPath(file), priorsSidecarPath(file), decisionsSidecarPath(file), trackSidecarPath(file)].map((path) => readFileSync(path, 'utf8'))).toEqual(sidecars);
  });

  it('`pitwall reprocess` of the continued file equals the live run\'s log', async () => {
    const root = tmp();
    const dirs = dataDir({ PITWALL_DATA_DIR: root });
    const place: Place = { db: openDatabase(dirs.dbPath), recordingsDir: dirs.recordings };
    await firstRun(segment, { place, wallMs: W0 });
    const again = await restartRun(segment, { place });
    expect(again.errors).toEqual([]);
    // one recording, continued: the reprocess runs it alone
    const continued = onlyRecording(place);
    const key = onlyKey(place.db);
    expect(sessionRows(place.db)[0]?.pwrec_path).toBe(continued);
    const live = factRows(place.db, key);
    expect(live.length).toBeGreaterThan(0);
    place.db.close();
    const out: string[] = [], err: string[] = [];
    const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: { PITWALL_DATA_DIR: root }, signal: new AbortController().signal };
    expect(await main(['reprocess'], io)).toBe(0);
    expect(err).toEqual([]);
    const db = openDatabase(dirs.dbPath);
    try {
      expect(factRows(db, key)).toEqual(live);
    } finally {
      db.close();
    }
  });
});

/** A unit that keeps the projection's decisions each frame; it reads `feed`, so it runs every frame. */
function decisionsProbe(): { feature: Feature; seen: DecisionRecord[][] } {
  const seen: DecisionRecord[][] = [];
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.restart-decisions-probe',
    reads: ['feed', 'decisions'],
    cadence: 'frame',
    compute: (view) => {
      seen.push(structuredClone([...(view.history as unknown as { decisions: readonly DecisionRecord[] }).decisions]));
      return seen.length;
    },
  };
  return { feature: defineFeature({ name: 'restart-decisions-probe', calculators: [calc], topics: [] }), seen };
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

describe('decisions sent while a restarted run restores its recording (C76, C38, C59)', { timeout: 180_000 }, () => {
  it('a calibration edit, a plan and a calibration pick sent during the restore are applied at the first live frame, in order', async () => {
    const sets = (dry: number): FakeSet[] => [
      { trackId: ZANDVOORT, id: 'dry', name: 'Dry', sources: 2, entries: { 'pitLoss.ms.green': known(dry, 0) } },
      { trackId: ZANDVOORT, id: 'wet', name: 'Wet', sources: 1, entries: { 'pitLoss.ms.green': known(25_000, 0) } },
    ];
    const player = carId(peekHeader(segment.rest[0]!.bytes)!.playerCarIndex);
    const plan: PlanDecision = { kind: 'planCommitted', carId: player, policy: { stops: [{ lap: 30, compound: 'hard' }], triggers: [] } };
    /** What the user and a teammate send, in this order: an edit of the set the run uses, a plan, a pick. */
    const send = (pipeline: FeedPipeline, cal: ReturnType<typeof fakeCalibration>): DecisionResult[] => {
      cal.edit(ZANDVOORT, 'dry', { 'pitLoss.ms.green': known(22_000, 0) });
      pipeline.calibrationEdited('dry');
      return [pipeline.commitPlan(plan), pipeline.commitDecision('wet')];
    };

    // one run that never stopped: the run preselects `dry`; the three are sent just before the first packet after the split
    const wholeCal = fakeCalibration(sets(21_000));
    const wholeProbe = decisionsProbe();
    const wholePlace = newPlace();
    let wholeAnswers: DecisionResult[] = [];
    const wholeSource = new HookedSource(new ArraySource(F, segment.packets), {
      after: (i) => { if (i === segment.split - 1) wholeAnswers = send(whole.pipeline, wholeCal); },
    });
    const whole = livePipeline(wholeSource, { place: wholePlace, wallMs: W0, features: [wholeProbe.feature], extra: { calibration: wholeCal.store } });
    whole.pipeline.start();
    await whole.pipeline.done;
    expect(whole.errors).toEqual([]);
    expect(wholeAnswers).toEqual([{ ok: true }, { ok: true }]);
    const wanted = wholeProbe.seen.at(-1)!;
    expect(wanted.map((d) => d.kind)).toEqual(['calibrationChosen', 'planCommitted', 'calibrationChosen']);

    // the first run stops at the split; the restarted run gets the rest, and the three are sent while it restores
    const root = tmp();
    const dirs = dataDir({ PITWALL_DATA_DIR: root });
    const place: Place = { db: openDatabase(dirs.dbPath), recordingsDir: dirs.recordings };
    const firstCal = fakeCalibration(sets(21_000));
    await firstRun(segment, { place, wallMs: W0, features: [decisionsProbe().feature], extra: { calibration: firstCal.store } });
    const againCal = fakeCalibration(sets(21_000));
    const probe = decisionsProbe();
    const again = livePipeline(new ArraySource(F, restarted(segment)), { place, wallMs: restartWall(segment), features: [probe.feature], extra: { calibration: againCal.store } });
    again.pipeline.start();
    // the rest has arrived and is buffered: the restore of the stored recording is under way; nothing is rejected
    expect(send(again.pipeline, againCal)).toEqual([{ ok: true }, { ok: true }]);
    await again.pipeline.done;
    expect(again.errors).toEqual([]);

    // the projection's decisions are one run's: in arrival order, each describing the first live frame
    const got = probe.seen.at(-1)!;
    expect(got).toEqual(wanted);
    expect(new Set(got.map((d) => d.frame)).size).toBe(1);
    // the decisions sidecar holds them at the record index after the resume record: the first part's records of the session
    const file = onlyRecording(place);
    const sessionUid = peekHeader(segment.rest[0]!.bytes)!.sessionUid;
    const firstPartRecords = segment.first.filter((p) => [sessionUid, 0n].includes(peekHeader(p.bytes)?.sessionUid ?? -1n)).length;
    const sidecar = readJson(decisionsSidecarPath(file)) as Array<{ recordIndex: number; decision: { kind: string } }>;
    expect(sidecar.map((e) => [e.recordIndex, e.decision.kind])).toEqual([
      [firstPartRecords, 'calibrationChosen'], [firstPartRecords, 'planCommitted'], [firstPartRecords, 'calibrationChosen'],
    ]);
    expect(sidecar).toEqual(readJson(decisionsSidecarPath(onlyRecording(wholePlace))));
    expect(readJson(priorsSidecarPath(file))).toEqual(readJson(priorsSidecarPath(onlyRecording(wholePlace))));
    // the stored log is one run's
    const key = onlyKey(place.db);
    const live = factRows(place.db, key);
    expect(live).toEqual(factRows(wholePlace.db, onlyKey(wholePlace.db)));

    // `pitwall reprocess` of the continued file gives the same decisions (C38)
    place.db.close();
    const out: string[] = [], err: string[] = [];
    const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: { PITWALL_DATA_DIR: root }, signal: new AbortController().signal };
    expect(await main(['reprocess'], io)).toBe(0);
    expect(err).toEqual([]);
    const db = openDatabase(dirs.dbPath);
    try {
      expect(factRows(db, key)).toEqual(live);
      expect(factRows(db, key).filter((row) => row.list === 'decisions')).toHaveLength(3);
    } finally {
      db.close();
    }
  });
});

describe('storage across a restart (C24, C61)', { timeout: 180_000 }, () => {
  it('with an unchanged rules version every stored list holds each fact once and its first-run entries unchanged', async () => {
    const whole = await oneRun(segment);
    const place = newPlace();
    await firstRun(segment, { place, wallMs: W0, rulesVersion: 'v1' });
    const key = onlyKey(place.db);
    const before = sessionRows(place.db)[0]!;
    const firstRows = factRows(place.db, key);
    expect(firstRows.length).toBeGreaterThan(0);
    // a stopped run stores only what happened: its rows are those of one run at the same positions
    const wholeRows = factRows(whole.place.db, onlyKey(whole.place.db));
    const at = (rows: typeof firstRows, list: string, seq: number) => rows.find((r) => r.list === list && r.seq === seq);
    for (const row of firstRows) expect(row).toEqual(at(wholeRows, row.list, row.seq));
    // a first-run row the restart must never touch: marked here, and no fact row may change or go from now on
    const marked = firstRows[0]!;
    place.db.prepare("UPDATE facts SET record = '{\"marked\":true}' WHERE session_uid = ? AND weekend_id = ? AND player_car = ? AND list = ? AND seq = ?")
      .run(key.sessionUid, key.weekendId, key.playerCar, marked.list, marked.seq);
    forbidFactRewrites(place.db);

    const again = await restartRun(segment, { place, rulesVersion: 'v1' });
    expect(again.errors).toEqual([]);
    const after = factRows(place.db, key);
    // each fact once: one run's rows, with the marked first-run row as it was
    expect(after).toEqual(wholeRows.map((row) => (row.list === marked.list && row.seq === marked.seq ? { ...row, record: { marked: true } } : row)));
    // the row keeps the first run's start and recording; the session is complete now
    expect(sessionRows(place.db)).toEqual([{ ...before, rules_version: 'v1', complete: 1 }]);
  });

  it('with a changed rules version the session\'s log is replaced whole', async () => {
    const place = newPlace();
    await firstRun(segment, { place, wallMs: W0, rulesVersion: 'v1' });
    const key = onlyKey(place.db);
    const before = sessionRows(place.db)[0]!;
    // the log of the older rules: one row differs, one more row
    const first = factRows(place.db, key)[0]!;
    place.db.prepare("UPDATE facts SET record = '{\"older\":true}' WHERE session_uid = ? AND weekend_id = ? AND player_car = ? AND list = ? AND seq = ?")
      .run(key.sessionUid, key.weekendId, key.playerCar, first.list, first.seq);
    place.db.prepare("INSERT INTO facts (session_uid, weekend_id, player_car, list, seq, car_id, record) VALUES (?, ?, ?, 'events', 999999, NULL, '{\"older\":true}')")
      .run(key.sessionUid, key.weekendId, key.playerCar);

    const again = await restartRun(segment, { place, rulesVersion: 'v2' });
    expect(again.errors).toEqual([]);
    const whole = await oneRun(segment, { rulesVersion: 'v2' });
    expect(factRows(place.db, key)).toEqual(factRows(whole.place.db, onlyKey(whole.place.db)));
    expect(sessionRows(place.db)).toEqual([{ ...before, rules_version: 'v2', complete: 1 }]);
  });
});

/** Delivers `bursts` of packets, each after waiting its delay in ms; done after the last. */
class StagedSource implements PacketSource {
  readonly feedId: FeedId;
  readonly done: Promise<void>;
  readonly #bursts: readonly PreparedPacket[][];
  readonly #delays: readonly number[];
  readonly #finish: PromiseWithResolvers<void> = Promise.withResolvers();
  #stopped = false;

  constructor(feedId: FeedId, bursts: readonly PreparedPacket[][], delays: readonly number[]) {
    this.feedId = feedId;
    this.#bursts = bursts;
    this.#delays = delays;
    this.done = this.#finish.promise;
  }

  start(on: (p: RawPacket) => void): void {
    void (async () => {
      for (const [i, burst] of this.#bursts.entries()) {
        const delay = this.#delays[i] ?? 0;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        for (const p of burst) if (!this.#stopped) on({ feedId: this.feedId, ...p });
      }
      this.#finish.resolve();
    })();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#finish.resolve();
  }
}
