// An edit of the set a run uses reaches the running session (SP4.1a Task a1; C62a, C73, C76, C38, C1a). After the
// calibration store accepts an edit of a set, `serve` calls `FeedPipeline.calibrationEdited(setId)` on every feed
// pipeline (`test/cli/serve-calibration-edit.test.ts` covers that wiring). A pipeline whose running session is on that
// set commits `calibrationChosen { setId, snapshot }` with the set's new snapshot, exactly as a pick does: the snapshot
// joins the run's priors and the priors sidecar, the decision goes to the runner with the next frame and, with its record
// index, to the decisions sidecar, and `calibration.active` follows. An unchanged fingerprint, another set, a run on
// `defaults`, a deleted set (ruling R29) and a feed without a running session commit nothing. A pick before any session
// (F5) is validated against the calibration store. The store is the fake of `helpers/fake-calibration.ts` (C84), except
// in the F5 row, which runs a real store on a temporary data dir with a fake read of the stored sessions.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TOPICS, type ServerMessage, type TopicName } from '@pitwall/contracts';
import { known, toSessionTime, unknown, type CalibrationSet, type FeedId, type PriorsEntries, type PriorsSnapshot } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine';
import { CalibrationStore } from '../../src/calibration/store.ts';
import { effectiveConfig } from '../../src/feature-config.ts';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import pitLoss from '../../src/features/pit-loss/register.ts';
import pitLosses from '../../src/features/pit-losses/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { recordingDecisions, type RecordedRun } from '../../src/pipeline/decision-sidecars.ts';
import { FeedPipeline, type FeedPipelineOptions } from '../../src/pipeline/feed-pipeline.ts';
import { StreamHash, topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { fakeCalibration, type FakeSet, type PipelineCalibration } from '../helpers/fake-calibration.ts';
import { HookedSource } from '../helpers/hooked-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { segmentPath } from '../fixtures/replay.ts';

/** `topicStreamHash`'s feed: `feed.status` names the feed, so a live run hashed against a replay runs on it too. */
const F = 'hash' as FeedId;
const ZANDVOORT = 26;
const SINGAPORE = 12;
const LAP10 = segmentPath('race-zandvoort-lap10.pwrec.gz');
/** The record of LAP10 (1778 records) before which the live run edits (or picks), and a later one. */
const EDIT_AT = 800;
const LATER = 1200;
const log = createLogger({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'calibration-edit-'));
const priorsSidecar = (file: string): string => `${file}.priors.json`;
const decisionsSidecar = (file: string): string => `${file}.decisions.json`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
/** The decisions sidecar's entries; none when the run wrote no sidecar. */
const decisionsOf = (file: string): unknown => (existsSync(decisionsSidecar(file)) ? readJson(decisionsSidecar(file)) : []);
const recordIndexOf = (file: string): number => (decisionsOf(file) as Array<{ recordIndex: number }>)[0]?.recordIndex ?? -1;

/** The pipeline with the method an edit reaches it through (Task a1). */
type EditablePipeline = FeedPipeline & { calibrationEdited(setId: string): void };

/** Pit-loss entries told apart by their values; `pit-loss` reads them, so `pitLosses.track` follows the priors. */
const entries = (greenMs: number): PriorsEntries => ({
  'pitLoss.ms.green': known(greenMs, toSessionTime(0)),
  'pitLoss.ms.sc': known(greenMs - 9_000, toSessionTime(0)),
});
/** Two sets on `trackId`: `dry` (the fake's preselection) and `wet`. */
const setsOn = (trackId: number): FakeSet[] => [
  { trackId, id: 'dry', name: 'Dry', sources: 3, entries: entries(21_500) },
  { trackId, id: 'wet', name: 'Wet', sources: 2, entries: entries(24_000) },
];

/** What the probe saw on one frame: the race clock, `view.priors` and the decisions in the projection. */
type Seen = { at: number; priors: EngineView['priors']; decisions: number };
const fingerprint = (s: Seen | undefined): string | null => (s?.priors.known === true ? s.priors.value.fingerprint : null);
/** The index of the first frame the probe saw with `n` decisions in the projection. */
const switchOf = (seen: readonly Seen[], n = 1): number => seen.findIndex((s) => s.decisions === n);

/** A unit that keeps what it sees each frame; it reads `view.priors`, so it declares `decisions` (C62a). */
function priorsProbe(): { feature: Feature; seen: Seen[] } {
  const seen: Seen[] = [];
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.priors-probe',
    reads: ['feed', 'decisions'],
    cadence: 'frame',
    compute: (view) => {
      seen.push({ at: view.live.sessionTime, priors: view.priors, decisions: view.history.decisions.length });
      return seen.length;
    },
  };
  return { feature: defineFeature({ name: 'priors-probe', calculators: [calc], topics: [] }), seen };
}

/** A user action between two records, after the record `at` and the hub's tick, as a click lands. */
type Step = { at: number; act: (pipeline: EditablePipeline) => void };
type RunOptions = { calibration?: PipelineCalibration; recorded?: RecordedRun; record?: boolean; steps?: Step[] };
type Run = { pipeline: EditablePipeline; seen: Seen[]; hash: string; values: Map<TopicName, unknown[]>; file: string | undefined };

/** The params `topicStreamHash` subscribes a topic without a `select` with (none of these features has one). */
const HASH_PARAMS = { carId: 0, referenceCarId: 0, reference: { kind: 'leaderAverage' } };

/**
 * Runs `path` through a pipeline of pit-loss, pit-losses and a probe, with one client subscribed, as `topicStreamHash`'s
 * is, to every feed topic once: the hub's clock on the record times, a tick after every record, then the steps due.
 * The client's messages are hashed as `topicStreamHash` hashes them, and every value of each topic is kept.
 */
async function run(path: string, o: RunOptions = {}): Promise<Run> {
  const probe = priorsProbe();
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const hash = new StreamHash(new Set());
  const values = new Map<TopicName, unknown[]>();
  hub.addClient('hash', {
    send: (message: ServerMessage) => {
      const topic = 'id' in message ? (message.id as TopicName | undefined) : undefined;
      if (topic === undefined) throw new Error(`a message of no subscription: ${JSON.stringify(message)}`);
      hash.add(topic, message);
      if (message.type === 'snapshot' || message.type === 'update') {
        values.set(topic, [...(values.get(topic) ?? []), 'entries' in message && message.entries !== undefined ? message.entries : message.value]);
      }
    },
    bufferedAmount: () => 0,
  });
  for (const topic of Object.keys(TOPICS) as TopicName[]) {
    if (TOPICS[topic].scope === 'feed') hub.subscribe({ clientId: 'hash', id: topic, topic, params: HASH_PARAMS, feedId: F });
  }
  const dir = o.record === true ? tmp() : undefined;
  const steps = o.steps ?? [];
  let ran = 0;
  let pipeline: EditablePipeline | undefined = undefined;
  const source = new HookedSource(new PwrecSource({ feedId: F, path, mode: 'asFastAsPossible' }), {
    before: (packet) => {
      nowMs = packet.receivedAtMs;
    },
    after: (index) => {
      hub.tick();
      for (const step of steps) {
        if (step.at !== index || pipeline === undefined) continue;
        ran++;
        step.act(pipeline);
      }
    },
  });
  pipeline = new FeedPipeline({
    feedId: F,
    source,
    hub,
    features: [pitLoss, pitLosses, probe.feature],
    log,
    ...(o.calibration && ({ calibration: o.calibration } satisfies Partial<FeedPipelineOptions>)),
    ...(o.recorded && ({ recorded: o.recorded } satisfies Partial<FeedPipelineOptions>)),
    ...(dir !== undefined && { storage: { rulesVersion: 'unversioned', db: openDatabase(join(tmp(), 'live.db')), recordingsDir: dir } }),
  }) as EditablePipeline;
  pipeline.start();
  await pipeline.done;
  hub.tick();
  expect(ran, 'every step ran').toBe(steps.length);
  let file: string | undefined;
  if (dir !== undefined) {
    const files = readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz'));
    expect(files).toHaveLength(1);
    file = join(dir, files[0]!);
  }
  return { pipeline, seen: probe.seen, hash: hash.digest(), values, file };
}

const lastOf = (r: Run, topic: TopicName): unknown => r.values.get(topic)?.at(-1);

/** What a run that committed nothing shows: no decision anywhere, the start snapshot throughout, `calibration.active` unpicked. */
function expectNothingCommitted(r: Run, start: PriorsSnapshot): void {
  expect(decisionsOf(r.file!)).toEqual([]);
  expect(readJson(priorsSidecar(r.file!))).toEqual({ start: start.fingerprint, snapshots: { [start.fingerprint]: start } });
  expect(r.seen.length).toBeGreaterThan(0);
  for (const s of r.seen) expect(s).toMatchObject({ priors: known(start, 0), decisions: 0 });
  expect(lastOf(r, 'calibration.active')).toMatchObject({ known: true, value: { setId: start.setId, snapshot: start.fingerprint, picked: false } });
}

describe('an edit of the set in use commits a decision (C62a, C76)', () => {
  const cal = fakeCalibration(setsOn(ZANDVOORT));
  let dry: PriorsSnapshot;
  let edited: PriorsSnapshot | undefined;
  let live: Run;
  /** A live run that picks `wet` at the moment `live` edits `dry`: the record index a pick gets there. */
  let picked: Run;
  beforeAll(async () => {
    dry = cal.snapshotNow(ZANDVOORT, 'dry');
    live = await run(LAP10, {
      calibration: cal.store,
      record: true,
      steps: [{
        at: EDIT_AT - 1,
        act: (pipeline) => {
          cal.edit(ZANDVOORT, 'dry', entries(30_000));
          edited = cal.snapshotNow(ZANDVOORT, 'dry');
          pipeline.calibrationEdited('dry');
        },
      }],
    });
    picked = await run(LAP10, { calibration: fakeCalibration(setsOn(ZANDVOORT)).store, record: true, steps: [{ at: EDIT_AT - 1, act: (pipeline) => pipeline.commitDecision('wet') }] });
  }, 90_000);

  it('the decision of an edit lands in the decisions sidecar and its snapshot in the priors sidecar', () => {
    expect(edited).toBeDefined();
    const now = edited!;
    expect(now.fingerprint).not.toBe(dry.fingerprint);
    // the new snapshot joins the run's priors (they only grow), the start one stays
    expect(readJson(priorsSidecar(live.file!))).toEqual({ start: dry.fingerprint, snapshots: { [dry.fingerprint]: dry, [now.fingerprint]: now } });
    // the decision names the set and its new snapshot, never the values (C23, C76), at the record index a pick there gets
    expect(recordIndexOf(picked.file!)).toBeGreaterThanOrEqual(0);
    expect(decisionsOf(live.file!)).toEqual([{ recordIndex: recordIndexOf(picked.file!), decision: { kind: 'calibrationChosen', setId: 'dry', snapshot: now.fingerprint } }]);
    // the units see the start snapshot, then the edited one from the decision's frame on
    const first = switchOf(live.seen);
    expect(first).toBeGreaterThan(0);
    expect(live.seen.slice(0, first).every((s) => fingerprint(s) === dry.fingerprint && s.decisions === 0)).toBe(true);
    expect(live.seen.slice(first).every((s) => fingerprint(s) === now.fingerprint && s.decisions === 1)).toBe(true);
    // calibration.active follows, `picked` as a pick's
    expect(lastOf(live, 'calibration.active')).toMatchObject({ known: true, value: { trackId: ZANDVOORT, setId: 'dry', snapshot: now.fingerprint, picked: true } });
  });

  it('a replay of a session with an edit decision switches at the same frame as the live run', async () => {
    // the store has moved on since: the replay reads both sidecars, never the store (C38)
    cal.edit(ZANDVOORT, 'dry', entries(40_000));
    const replay = await run(live.file!, { recorded: recordingDecisions(live.file!) });
    expect(switchOf(replay.seen)).toBe(switchOf(live.seen));
    expect(replay.seen[switchOf(replay.seen)]?.at).toBe(live.seen[switchOf(live.seen)]?.at);
    expect(replay.seen).toEqual(live.seen);
    // and the whole topic stream equals the live one
    expect(await topicStreamHash(live.file!, { features: [pitLoss, pitLosses] })).toBe(live.hash);
  }, 60_000);
});

describe('edits that commit nothing (C62a, ruling R29)', () => {
  it('an edit that leaves the snapshot\'s fingerprint unchanged commits nothing', async () => {
    const cal = fakeCalibration(setsOn(ZANDVOORT));
    const dry = cal.snapshotNow(ZANDVOORT, 'dry');
    const live = await run(LAP10, {
      calibration: cal.store,
      record: true,
      steps: [
        // an edit that ends where it started (an override set, then cleared); a rename changes the fingerprint since F4
        { at: EDIT_AT - 1, act: (pipeline) => pipeline.calibrationEdited('dry') },
        { at: LATER, act: (pipeline) => pipeline.calibrationEdited('dry') },
      ],
    });
    expect(cal.snapshotNow(ZANDVOORT, 'dry').fingerprint).toBe(dry.fingerprint);
    expectNothingCommitted(live, dry);
  }, 60_000);

  it('an edit of another set, or while the run is on defaults, commits nothing', async () => {
    // another set: the run is on `dry`, `wet` is edited
    const other = fakeCalibration(setsOn(ZANDVOORT));
    const dry = other.snapshotNow(ZANDVOORT, 'dry');
    const onDry = await run(LAP10, {
      calibration: other.store,
      record: true,
      steps: [{ at: EDIT_AT - 1, act: (pipeline) => { other.edit(ZANDVOORT, 'wet', entries(33_000)); pipeline.calibrationEdited('wet'); } }],
    });
    expectNothingCommitted(onDry, dry);

    // defaults: the run picks `defaults`, then `dry` is edited; only the pick is recorded
    const cal = fakeCalibration(setsOn(ZANDVOORT));
    const onDefaults = await run(LAP10, {
      calibration: cal.store,
      record: true,
      steps: [
        { at: EDIT_AT - 1, act: (pipeline) => pipeline.commitDecision(null) },
        { at: LATER, act: (pipeline) => { cal.edit(ZANDVOORT, 'dry', entries(30_000)); pipeline.calibrationEdited('dry'); } },
      ],
    });
    expect(decisionsOf(onDefaults.file!)).toEqual([{ recordIndex: expect.any(Number), decision: { kind: 'calibrationChosen', setId: null, snapshot: null } }]);
    expect(readJson(priorsSidecar(onDefaults.file!))).toEqual({ start: dry.fingerprint, snapshots: { [dry.fingerprint]: dry } });
    expect(onDefaults.seen.at(-1)).toMatchObject({ priors: unknown('notApplicable'), decisions: 1 });
    expect(lastOf(onDefaults, 'calibration.active')).toMatchObject({ known: true, value: { setId: null, snapshot: null, picked: true } });

    // a feed without a running session: the run above has ended, and a pipeline that never started has none
    const priorsBefore = readJson(priorsSidecar(onDry.file!));
    other.edit(ZANDVOORT, 'dry', entries(35_000));
    onDry.pipeline.calibrationEdited('dry');
    expect(decisionsOf(onDry.file!)).toEqual([]);
    expect(readJson(priorsSidecar(onDry.file!))).toEqual(priorsBefore);
    const idle = new FeedPipeline({ feedId: F, source: new ManualSource(F), hub: new TopicHub({ now: () => 0 }), features: [], log, calibration: other.store }) as EditablePipeline;
    expect(() => idle.calibrationEdited('dry')).not.toThrow();
  }, 90_000);

  it('deleting the set in use commits nothing and the run keeps its snapshot', async () => {
    const cal = fakeCalibration(setsOn(ZANDVOORT));
    const dry = cal.snapshotNow(ZANDVOORT, 'dry');
    const live = await run(LAP10, {
      calibration: cal.store,
      record: true,
      steps: [{ at: EDIT_AT - 1, act: (pipeline) => { cal.remove(ZANDVOORT, 'dry'); pipeline.calibrationEdited('dry'); } }],
    });
    expect(cal.store.snapshotOf(ZANDVOORT, 'dry')).toBeUndefined();
    expectNothingCommitted(live, dry);
  }, 60_000);
});

describe('a pick before any session on the feed (F5, C73)', () => {
  const NOW = '2026-11-06T12:00:00.000Z';
  const writeSetFile = (dataDir: string, set: CalibrationSet): void => {
    mkdirSync(join(dataDir, 'calibration', String(set.trackId)), { recursive: true });
    writeFileSync(join(dataDir, 'calibration', String(set.trackId), `${set.id}.json`), JSON.stringify(set));
  };
  const readSetFile = (dataDir: string, trackId: number, id: string): CalibrationSet =>
    readJson(join(dataDir, 'calibration', String(trackId), `${id}.json`)) as CalibrationSet;

  it('a pick before any session marks an existing set used and rejects an unknown one', async () => {
    // a real calibration store on a temporary data dir, with no stored session (C84)
    const dataDir = tmp();
    const set = (trackId: number, id: string): CalibrationSet => ({ id, trackId, name: id, createdAt: '2026-10-01T20:00:00.000Z', sources: [], overrides: {}, preferred: false });
    writeSetFile(dataDir, set(ZANDVOORT, 'dry'));
    writeSetFile(dataDir, set(SINGAPORE, 'wet'));
    const store = CalibrationStore.open(dataDir, {
      features: [pitLoss],
      repo: { sessionsOnTrack: () => [], newestTrackId: () => null },
      config: effectiveConfig([pitLoss]),
      hub: { publishGlobal: vi.fn() },
      log,
      rebuild: async () => {},
    });
    const source = new ManualSource(F);
    const pipeline = new FeedPipeline({ feedId: F, source, hub: new TopicHub({ now: () => 0 }), features: [], log, calibration: store, wallClock: () => Date.parse(NOW) });
    pipeline.start();
    try {
      // an existing set, on its own track (no session names one yet): marked used
      expect(pipeline.commitDecision('wet')).toEqual({ ok: true });
      expect(readSetFile(dataDir, SINGAPORE, 'wet').lastUsedAt).toBe(NOW);
      expect(readSetFile(dataDir, ZANDVOORT, 'dry').lastUsedAt).toBeUndefined();
      // an unknown set: rejected with a message, nothing marked
      expect(pipeline.commitDecision('no-such-set')).toEqual({ ok: false, reason: 'invalid', message: expect.stringMatching(/\S/) });
      // defaults: ok, nothing changes
      expect(pipeline.commitDecision(null)).toEqual({ ok: true });
      expect(readSetFile(dataDir, ZANDVOORT, 'dry').lastUsedAt).toBeUndefined();
      expect(readSetFile(dataDir, SINGAPORE, 'wet').lastUsedAt).toBe(NOW);
      expect(readdirSync(join(dataDir, 'calibration', String(ZANDVOORT)))).toEqual(['dry.json']);
    } finally {
      await pipeline.stop();
      store.close();
    }
  });
});
