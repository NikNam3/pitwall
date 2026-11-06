// Decisions and priors snapshots in the bridge (C27a, C29, C33, C38, C59, C62a, C73, C76; spec 3.3, 3.4). A live run
// starts on the calibration store's preselection and writes the run's priors next to its recording as
// `<file>.priors.json` (`RunPriors`, at session start and again on each pick). A pick (`FeedPipeline.commitDecision`)
// takes the set's snapshot from the store, adds it to the run's priors and the sidecar, hands the runner the decision
// `calibrationChosen { setId, snapshot }` with the next frame and appends it, with its record index, to
// `<file>.decisions.json`. A replay feeds both sidecars back (`recordingDecisions`), so it reproduces the live stream
// whatever the store holds by then; a recording without them runs on `notApplicable`. The store here is a fake (C84).
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TOPICS, type ServerMessage, type TopicName } from '@pitwall/contracts';
import { known, sessionPhaseRaceSpans, sessionUidString, toSessionTime, unknown, type FeedId, type PriorsEntries, type PriorsSnapshot } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine';
import { sessionConfigPath } from '../../src/feature-config.ts';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import pitLoss from '../../src/features/pit-loss/register.ts';
import pitLosses from '../../src/features/pit-losses/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { recordingDecisions, type RecordedRun } from '../../src/pipeline/decision-sidecars.ts';
import { FeedPipeline, type DecisionResult, type FeedPipelineOptions } from '../../src/pipeline/feed-pipeline.ts';
import { StreamHash, topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { trackSidecarPath } from '../../src/track-files/load.ts';
import { fakeCalibration, type FakeSet, type PipelineCalibration } from '../helpers/fake-calibration.ts';
import { HookedSource } from '../helpers/hooked-source.ts';
import { segmentPath } from '../fixtures/replay.ts';

/** `topicStreamHash`'s feed: `feed.status` names the feed, so a live run hashed against a replay runs on it too. */
const F = 'hash' as FeedId;
const ZANDVOORT = 26;
const SINGAPORE = 12;
const LAP10 = segmentPath('race-zandvoort-lap10.pwrec.gz');
const FLASHBACK = segmentPath('race-singapore-wet-flashback.pwrec.gz');
const WET_START = segmentPath('race-singapore-wet-start.pwrec.gz');
/** The record of LAP10 (1778 records) before which the live run picks a set. */
const PICK_AT = 800;
const ISO = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
const PHASE = sessionPhaseRaceSpans.machine;
const log = createLogger({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'decisions-priors-'));
const priorsSidecar = (file: string): string => `${file}.priors.json`;
const decisionsSidecar = (file: string): string => `${file}.decisions.json`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
/** The decisions sidecar's entries; none when the run wrote no sidecar. */
const decisionsOf = (file: string): unknown => (existsSync(decisionsSidecar(file)) ? readJson(decisionsSidecar(file)) : []);

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

/** What the probe saw on one frame: the race clock, the open session phase, `view.priors` and the decisions in the projection. */
type Seen = { at: number; phase: string | undefined; priors: EngineView['priors']; decisions: number };
const fingerprint = (s: Seen | undefined): string | null => (s?.priors.known === true ? s.priors.value.fingerprint : null);

/**
 * A unit that keeps what it sees each frame; it reads `view.priors`, so it declares `decisions` (C62a). Nothing reads
 * it, so it always runs, and it reads `feed`, which changes on every frame, so it runs on every frame.
 */
function priorsProbe(): { feature: Feature; seen: Seen[] } {
  const seen: Seen[] = [];
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.priors-probe',
    reads: ['feed', 'decisions', 'spans:session-phase-race'],
    cadence: 'frame',
    compute: (view) => {
      seen.push({ at: view.live.sessionTime, phase: view.situation.byMachine[PHASE]?.[0]?.kind, priors: view.priors, decisions: view.history.decisions.length });
      return seen.length;
    },
  };
  return { feature: defineFeature({ name: 'priors-probe', calculators: [calc], topics: [] }), seen };
}

type Pick = { setId: string | null; when: (index: number, seen: readonly Seen[]) => boolean };
type RunOptions = {
  /** Live: the store the run takes its preselection and its picks' snapshots from. */
  calibration?: PipelineCalibration;
  /** A replay: the recording's sidecars. */
  recorded?: RecordedRun;
  /** Live: a recordings dir (and a database), so the run writes a session file with its sidecars. */
  record?: boolean;
  /** Live: one pick, after the first record for which `when` holds. */
  pick?: Pick;
};
/** `answer`: what `commitDecision` answered the pick; undefined without one. */
type Run = { pipeline: FeedPipeline; seen: Seen[]; hash: string; values: Map<TopicName, unknown[]>; file: string | undefined; answer: DecisionResult | undefined };

/** The params `topicStreamHash` subscribes a topic without a `select` with (none of these features has one). */
const HASH_PARAMS = { carId: 0, referenceCarId: 0, reference: { kind: 'leaderAverage' } };

/**
 * Runs `path` through a pipeline of pit-loss, pit-losses and a probe, with one client subscribed, as `topicStreamHash`'s
 * is, to every feed topic once: the hub's clock on the record times, a tick after every record. The client's messages
 * are hashed as `topicStreamHash` hashes them, and every value of each topic is kept. A pick happens between two
 * records, after the tick, as a user's click does.
 */
async function run(path: string, o: RunOptions = {}): Promise<Run> {
  const probe = priorsProbe();
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const hash = new StreamHash(new Set());
  const values = new Map<TopicName, unknown[]>();
  const keep = (topic: TopicName, value: unknown) => values.set(topic, [...(values.get(topic) ?? []), value]);
  hub.addClient('hash', {
    send: (message: ServerMessage) => {
      const topic = 'id' in message ? (message.id as TopicName | undefined) : undefined;
      if (topic === undefined) throw new Error(`a message of no subscription: ${JSON.stringify(message)}`);
      hash.add(topic, message);
      if (message.type === 'snapshot' || message.type === 'update') keep(topic, 'entries' in message && message.entries !== undefined ? message.entries : message.value);
    },
    bufferedAmount: () => 0,
  });
  for (const topic of Object.keys(TOPICS) as TopicName[]) {
    if (TOPICS[topic].scope === 'feed') hub.subscribe({ clientId: 'hash', id: topic, topic, params: HASH_PARAMS, feedId: F });
  }
  const dir = o.record === true ? tmp() : undefined;
  let picked = false;
  let answer: DecisionResult | undefined = undefined;
  let pipeline: FeedPipeline | undefined = undefined;
  const source = new HookedSource(new PwrecSource({ feedId: F, path, mode: 'asFastAsPossible' }), {
    before: (packet) => {
      nowMs = packet.receivedAtMs;
    },
    after: (index) => {
      hub.tick();
      if (o.pick !== undefined && !picked && o.pick.when(index, probe.seen)) {
        picked = true;
        answer = pipeline?.commitDecision(o.pick.setId);
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
  });
  pipeline.start();
  await pipeline.done;
  hub.tick();
  if (o.pick !== undefined) expect(picked, 'the pick happened').toBe(true);
  let file: string | undefined;
  if (dir !== undefined) {
    const files = readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz'));
    expect(files).toHaveLength(1);
    file = join(dir, files[0]!);
  }
  return { pipeline, seen: probe.seen, hash: hash.digest(), values, file, answer };
}

const lastOf = (r: Run, topic: TopicName): unknown => r.values.get(topic)?.at(-1);

describe('a live run and the priors sidecar (C59, C62a)', () => {
  it('a live run writes the priors sidecar at session start', async () => {
    const cal = fakeCalibration(setsOn(ZANDVOORT));
    const dry = cal.snapshotNow(ZANDVOORT, 'dry');
    const live = await run(LAP10, { calibration: cal.store, record: true });
    expect(readJson(priorsSidecar(live.file!))).toEqual({ start: dry.fingerprint, snapshots: { [dry.fingerprint]: dry } });
    // the run starts on the preselection at once (C62a), and starting on it uses the set (spec 3.1)
    expect(live.seen.length).toBeGreaterThan(0);
    for (const s of live.seen) expect(s.priors).toEqual(known(dry, 0));
    expect(cal.markUsed).toHaveBeenCalledWith(ZANDVOORT, 'dry', ISO);

    // without a set on the track: no start snapshot, and the run is notApplicable
    const none = await run(LAP10, { calibration: fakeCalibration([]).store, record: true });
    expect(readJson(priorsSidecar(none.file!))).toEqual({ start: null, snapshots: {} });
    for (const s of none.seen) expect(s.priors).toEqual(unknown('notApplicable'));
  }, 60_000);
});

describe('a pick in a live run', () => {
  const cal = fakeCalibration(setsOn(ZANDVOORT));
  const features = [pitLoss, pitLosses];
  let dry: PriorsSnapshot;
  let wet: PriorsSnapshot;
  let live: Run;
  /** The store's calls during the live run, kept here: vitest clears mocks before each test. */
  let snapshotOfCalls: unknown[][];
  let markUsedCalls: unknown[][];
  beforeAll(async () => {
    dry = cal.snapshotNow(ZANDVOORT, 'dry');
    wet = cal.snapshotNow(ZANDVOORT, 'wet');
    live = await run(LAP10, { calibration: cal.store, record: true, pick: { setId: 'wet', when: (index) => index === PICK_AT - 1 } });
    snapshotOfCalls = [...cal.snapshotOf.mock.calls];
    markUsedCalls = [...cal.markUsed.mock.calls];
  }, 60_000);

  it('a pick adds its snapshot to the priors sidecar and the decision to the decisions sidecar', () => {
    expect(readJson(priorsSidecar(live.file!))).toEqual({ start: dry.fingerprint, snapshots: { [dry.fingerprint]: dry, [wet.fingerprint]: wet } });
    // the decision names the set and the snapshot, never the values (C23, C62a, C76)
    expect(decisionsOf(live.file!)).toEqual([{ recordIndex: expect.any(Number), decision: { kind: 'calibrationChosen', setId: 'wet', snapshot: wet.fingerprint } }]);
    const recordIndex = (decisionsOf(live.file!) as Array<{ recordIndex: number }>)[0]?.recordIndex ?? -1;
    expect(Number.isInteger(recordIndex) && recordIndex >= 0).toBe(true);
    expect(snapshotOfCalls).toContainEqual([ZANDVOORT, 'wet']);
    expect(markUsedCalls).toContainEqual([ZANDVOORT, 'wet', ISO]);
    // the units see the start snapshot, then the picked one from the decision's frame on
    expect(live.seen[0]?.priors).toEqual(known(dry, 0));
    expect(live.seen.at(-1)).toMatchObject({ priors: known(wet, 0), decisions: 1 });
    const first = live.seen.findIndex((s) => s.decisions === 1);
    expect(live.seen.slice(0, first).every((s) => fingerprint(s) === dry.fingerprint)).toBe(true);
    expect(live.seen.slice(first).every((s) => fingerprint(s) === wet.fingerprint)).toBe(true);
  });

  it('calibration.active names the preselected set at session start and the picked one after a pick', () => {
    const active = live.values.get('calibration.active') ?? [];
    const sessionUid = sessionUidString(13536157633115227668n);
    expect(active[0]).toMatchObject({ known: true, value: { sessionUid, trackId: ZANDVOORT, setId: 'dry', setName: 'Dry', snapshot: dry.fingerprint, picked: false } });
    expect(active.at(-1)).toMatchObject({ known: true, value: { sessionUid, trackId: ZANDVOORT, setId: 'wet', setName: 'Wet', snapshot: wet.fingerprint, picked: true } });
  });

  it('a replay with both sidecars equals the live run (C38)', async () => {
    // the replay of the session file the live run wrote, with its sidecars
    expect(await topicStreamHash(live.file!, { features })).toBe(live.hash);
    // and the replay follows its decisions sidecar: the same session file without it gives another stream
    const other = join(tmp(), 'other.pwrec.gz');
    copyFileSync(live.file!, other);
    for (const sidecar of [sessionConfigPath, trackSidecarPath, priorsSidecar]) copyFileSync(sidecar(live.file!), sidecar(other));
    expect(await topicStreamHash(other, { features })).not.toBe(live.hash);
  }, 60_000);

  it('a set edited after the pick: the replay still sees the picked values', async () => {
    cal.edit(ZANDVOORT, 'wet', entries(30_000));
    expect(cal.snapshotNow(ZANDVOORT, 'wet').fingerprint).not.toBe(wet.fingerprint);
    const replay = await run(live.file!, { recorded: recordingDecisions(live.file!) });
    expect(replay.seen[0]?.priors).toEqual(known(dry, 0));
    expect(replay.seen.at(-1)).toMatchObject({ priors: known(wet, 0), decisions: 1 });
  }, 60_000);

  it('calibration.choose without a running session only sets lastUsedAt', () => {
    // the live run's session has ended: a pick now reaches no run
    const priorsBefore = readJson(priorsSidecar(live.file!));
    const decisionsBefore = decisionsOf(live.file!);
    cal.markUsed.mockClear();
    cal.snapshotOf.mockClear();
    live.pipeline.commitDecision('dry');
    expect(cal.markUsed).toHaveBeenCalledTimes(1);
    expect(cal.markUsed).toHaveBeenCalledWith(ZANDVOORT, 'dry', ISO);
    expect(readJson(priorsSidecar(live.file!))).toEqual(priorsBefore);
    expect(decisionsOf(live.file!)).toEqual(decisionsBefore);
  });

  it('calibration.choose of an unknown set without a running session is rejected as invalid', () => {
    // the live run's session has ended: the bridge still validates the pick (C73) and changes nothing
    const priorsBefore = readJson(priorsSidecar(live.file!));
    const decisionsBefore = decisionsOf(live.file!);
    cal.markUsed.mockClear();
    expect(live.pipeline.commitDecision('no-such-set')).toEqual({ ok: false, reason: 'invalid', message: expect.stringMatching(/\S/) });
    expect(cal.markUsed).not.toHaveBeenCalled();
    expect(readJson(priorsSidecar(live.file!))).toEqual(priorsBefore);
    expect(decisionsOf(live.file!)).toEqual(decisionsBefore);
  });
});

describe('an unknown set or snapshot (C3, C73)', () => {
  it('a pick of an unknown set is rejected as invalid with a message and changes nothing', async () => {
    const cal = fakeCalibration(setsOn(ZANDVOORT));
    const dry = cal.snapshotNow(ZANDVOORT, 'dry');
    const live = await run(LAP10, { calibration: cal.store, record: true, pick: { setId: 'no-such-set', when: (index) => index === PICK_AT - 1 } });
    expect(live.answer).toEqual({ ok: false, reason: 'invalid', message: expect.stringMatching(/\S/) });
    // no snapshot joins the priors sidecar, no decision is recorded, and the set is not marked used
    expect(readJson(priorsSidecar(live.file!))).toEqual({ start: dry.fingerprint, snapshots: { [dry.fingerprint]: dry } });
    expect(decisionsOf(live.file!)).toEqual([]);
    expect(cal.markUsed.mock.calls).toEqual([[ZANDVOORT, 'dry', ISO]]);
    // and the run never sees a decision: the start snapshot throughout
    for (const s of live.seen) expect(s).toMatchObject({ priors: known(dry, 0), decisions: 0 });
    expect(lastOf(live, 'calibration.active')).toMatchObject({ known: true, value: { setId: 'dry', snapshot: dry.fingerprint, picked: false } });
  }, 60_000);

  it('calibration.active follows priorsOf for a decision naming an unknown snapshot', async () => {
    // a session file whose decisions sidecar names a fingerprint its priors sidecar does not hold
    const dry = fakeCalibration(setsOn(ZANDVOORT)).snapshotNow(ZANDVOORT, 'dry');
    const file = join(tmp(), 'unknown-snapshot.pwrec.gz');
    copyFileSync(LAP10, file);
    writeFileSync(priorsSidecar(file), JSON.stringify({ start: dry.fingerprint, snapshots: { [dry.fingerprint]: dry } }));
    const missing = 'f'.repeat(16);
    writeFileSync(decisionsSidecar(file), JSON.stringify([{ recordIndex: PICK_AT, decision: { kind: 'calibrationChosen', setId: 'wet', snapshot: missing } }]));
    const recorded = recordingDecisions(file);
    expect(recorded.decisions).toHaveLength(1);
    const replay = await run(file, { recorded });
    // the units see the start snapshot, then notApplicable from the decision on (priorsOf)
    expect(replay.seen[0]?.priors).toEqual(known(dry, 0));
    expect(replay.seen.at(-1)).toMatchObject({ priors: unknown('notApplicable'), decisions: 1 });
    // and calibration.active agrees with them: it names no snapshot
    expect(replay.values.get('calibration.active')?.[0]).toMatchObject({ known: true, value: { snapshot: dry.fingerprint } });
    expect(lastOf(replay, 'calibration.active')).toMatchObject({ known: true, value: { snapshot: null, setName: '' } });
  }, 60_000);
});

describe('a flashback and a pick (C27a, C33)', () => {
  it('a flashback that voids the pick restores the start priors (C27a, C33)', async () => {
    const cal = fakeCalibration(setsOn(SINGAPORE));
    const dry = cal.snapshotNow(SINGAPORE, 'dry');
    const wet = cal.snapshotNow(SINGAPORE, 'wet');
    // the segment's first pass runs 741.5 to 744.5 s, the flashback goes back to 742.045 s: a pick 2 s into the first
    // pass lies after the rewind's target
    const withPick = await run(FLASHBACK, {
      calibration: cal.store,
      pick: { setId: 'wet', when: (_index, seen) => seen.length > 0 && seen.at(-1)!.at >= seen[0]!.at + 2_000 },
    });
    // the pick took effect before the rewind
    expect(withPick.seen.some((s) => fingerprint(s) === wet.fingerprint)).toBe(true);
    // after the rewind the decision never happened: the start snapshot again
    expect(withPick.seen.at(-1)).toMatchObject({ priors: known(dry, 0), decisions: 0 });
    // and the topics equal those of a run that never received the pick
    const without = await run(FLASHBACK, { calibration: fakeCalibration(setsOn(SINGAPORE)).store });
    for (const topic of ['calibration.active', 'pitLosses.track'] as const) {
      expect(lastOf(withPick, topic), topic).toBeDefined();
      expect(lastOf(withPick, topic), topic).toEqual(lastOf(without, topic));
    }
    expect(lastOf(withPick, 'calibration.active')).toMatchObject({ known: true, value: { setId: 'dry', snapshot: dry.fingerprint, picked: false } });
  }, 60_000);
});

describe('a pick and the formation lap (C29)', () => {
  it('a pick in the formation lap counts (C29)', async () => {
    const cal = fakeCalibration(setsOn(SINGAPORE));
    const dry = cal.snapshotNow(SINGAPORE, 'dry');
    const wet = cal.snapshotNow(SINGAPORE, 'wet');
    // the segment holds the formation start, the formation-end reset, the start lights and lights out
    const live = await run(WET_START, { calibration: cal.store, pick: { setId: 'wet', when: (_index, seen) => seen.at(-1)?.phase === 'formation' } });
    const first = live.seen.findIndex((s) => s.decisions === 1);
    expect(first).toBeGreaterThan(0);
    // the decision describes a frame of the formation lap and is never hidden by it (C29)
    expect(live.seen[first]?.phase).toBe('formation');
    expect(live.seen.slice(0, first).every((s) => fingerprint(s) === dry.fingerprint)).toBe(true);
    expect(live.seen.slice(first).every((s) => s.decisions === 1 && fingerprint(s) === wet.fingerprint)).toBe(true);
    // and it still counts after lights out
    const racing = live.seen.filter((s) => s.phase === 'racing');
    expect(racing.length).toBeGreaterThan(0);
    for (const s of racing) expect(s.priors).toEqual(known(wet, 0));
  }, 60_000);
});

describe('a recording without sidecars', () => {
  it('a recording without a priors sidecar runs on notApplicable', async () => {
    // every committed segment predates the priors and decisions sidecars
    const recorded = recordingDecisions(LAP10);
    expect(recorded).toEqual({ priors: { start: null, snapshots: {} }, decisions: [] });
    const replay = await run(LAP10, { recorded });
    expect(replay.seen.length).toBeGreaterThan(0);
    for (const s of replay.seen) expect(s).toMatchObject({ priors: unknown('notApplicable'), decisions: 0 });
  }, 60_000);
});
