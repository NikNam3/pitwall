// Realism mode in the bridge (spec 7.9): set between sessions, kept for the whole session, saved in the session's
// config sidecar, so a replay reproduces the masked values.
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import type { ServerMessage, SessionInfo, TopicName } from '@pitwall/contracts';
import { unknown, type CarState, type FeedId } from '@pitwall/domain';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { effectiveConfig, recordingConfig, sessionConfigPath } from '../../src/feature-config.ts';
import carDetail from '../../src/features/car-detail/register.ts';
import realism from '../../src/features/realism/register.ts';
import sessionInfo from '../../src/features/session-info/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { UiState } from '../../src/ui-state/ui-state.ts';
import type { PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const F = 'test' as FeedId;
const features = [realism, sessionInfo, carDetail];
const log = createLogger({ level: 'silent' });
const REALISM = unknown('realism');
const tmp = () => mkdtempSync(join(tmpdir(), 'realism-'));

/** One session of 6 cars (player 0, teammate 1, car 3 a rival) with Car Damage and Tyre Sets in every frame. */
const session = (uid: bigint, offsetMs: number): PreparedPacket[] =>
  new ScenarioBuilder({ sessionUid: uid, cars: 6 }).session().participants().frames(30, (d) => {
    d.add('carDamage');
    for (const carIdx of [0, 1, 3]) d.add('tyreSets', { carIdx });
  }).packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs: receivedAtMs + offsetMs }));

const opened: UiState[] = [];
afterEach(() => { for (const s of opened.splice(0)) s.close(); });

/** A live bridge: ManualSource, a hub with a client that keeps the last value of each subscription, UiState, session files. */
function live() {
  const dir = tmp();
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const last = new Map<string, any>();
  hub.addClient('c', {
    send: (m: ServerMessage) => { if ((m.type === 'snapshot' || m.type === 'update') && 'value' in m) last.set(m.id, m.value); },
    bufferedAmount: () => 0,
  });
  const uiState = UiState.open(join(dir, 'ui'), hub, log);
  opened.push(uiState);
  const sub = (id: string, topic: TopicName, params: object = {}) => hub.subscribe({ clientId: 'c', id, topic, params, feedId: F });
  hub.subscribe({ clientId: 'c', id: 'settings', topic: 'ui.settings', params: {}, feedId: undefined });
  sub('info', 'session.info');
  sub('rival', 'car.detail', { carId: 3 });
  sub('player', 'car.detail', { carId: 0 });
  const source = new ManualSource(F);
  const recordingsDir = join(dir, 'rec');
  mkdirSync(recordingsDir);
  const pipeline = new FeedPipeline({
    feedId: F, source, hub, features, log, storage: { db: openDatabase(join(dir, 'p.db')), recordingsDir },
    realismNextSession: () => uiState.realismNextSession(),
  } as ConstructorParameters<typeof FeedPipeline>[0]);
  pipeline.start();
  const push = (packets: readonly PreparedPacket[]) => {
    for (const p of packets) { nowMs = p.receivedAtMs; source.push(p.bytes, p.receivedAtMs); hub.tick(); }
    nowMs += 10_000; hub.tick();
  };
  const files = () => readdirSync(recordingsDir).filter((n) => n.endsWith('.pwrec.gz')).map((n) => join(recordingsDir, n));
  return {
    uiState, push, last, files, recordingsDir,
    info: () => last.get('info') as SessionInfo,
    rival: () => last.get('rival') as CarState,
    player: () => last.get('player') as CarState,
    settings: () => last.get('settings') as { realismNextSession: boolean },
    tick: () => { nowMs += 10_000; hub.tick(); },
    finish: async () => { await pipeline.stop(); },
  };
}
const sidecarOf = (file: string): any => JSON.parse(readFileSync(sessionConfigPath(file), 'utf8'));
const byUid = (files: string[], uidHex: string): string => files.find((f) => f.includes(uidHex))!;

describe('the realism feature', () => {
  it('declares the config key realism with default { enabled: false } and runs no calculators', () => {
    expect(realism.name).toBe('realism');
    expect(realism.calculators).toEqual([]);
    expect(realism.topics).toEqual([]);
    expect(realism.config?.map((c) => [c.key, c.defaults])).toEqual([['realism', { enabled: false }]]);
    expect(effectiveConfig([realism])).toEqual({ realism: { enabled: false } });
  });
});

describe('session.info.realism', () => {
  it('is a boolean in the topic type', () => {
    expectTypeOf<SessionInfo['realism']>().toEqualTypeOf<boolean>();
  });
  it('the calculator takes it from engine state', () => {
    const calc = sessionInfo.calculators[0] as { compute: (view: any) => SessionInfo };
    const state = (on: boolean) => ({
      feedId: F, sessionUid: '1', playerCar: 0, realism: on, session: { trackId: 1 },
    });
    expect(calc.compute({ state: state(true) }).realism).toBe(true);
    expect(calc.compute({ state: state(false) }).realism).toBe(false);
  });
});

describe('FeedPipeline: realism between sessions', () => {
  it('toggling realism.set during a session changes ui.settings but not session.info.realism; the next session uses it', async () => {
    const b = live();
    const first = session(77n, 0);
    const half = Math.floor(first.length / 2);
    b.push(first.slice(0, half));
    expect(b.settings().realismNextSession).toBe(false);
    expect(b.info().realism).toBe(false);

    expect(b.uiState.apply({ kind: 'realism.set', enabled: true })).toEqual({ ok: true });
    b.tick();
    expect(b.settings().realismNextSession).toBe(true);
    b.push(first.slice(half));
    // same session: still off, and the rival's data still flows
    expect(b.info().realism).toBe(false);
    expect(b.rival().energy.fuel.known).toBe(true);

    b.push(session(78n, 60_000));
    expect(b.info().realism).toBe(true);
    expect(b.rival().energy.fuel).toEqual(REALISM);
    expect(b.rival().tyres.corners.fl.surfaceTempC).toEqual(REALISM);
    expect(b.rival().dynamics).toEqual(REALISM);
    expect(b.rival().timing.position).toBeGreaterThanOrEqual(0);
    expect(b.player().energy.fuel.known).toBe(true);
    expect(b.player().dynamics.known).toBe(true);
    await b.finish();
  });

  it('the value is kept for the whole session: switching it back off mid-session changes only the next one', async () => {
    const b = live();
    b.uiState.apply({ kind: 'realism.set', enabled: true });
    const first = session(77n, 0);
    const half = Math.floor(first.length / 2);
    b.push(first.slice(0, half));
    expect(b.info().realism).toBe(true);
    b.uiState.apply({ kind: 'realism.set', enabled: false });
    b.push(first.slice(half));
    expect(b.info().realism).toBe(true);
    expect(b.rival().energy.fuel).toEqual(REALISM);
    b.push(session(78n, 60_000));
    expect(b.info().realism).toBe(false);
    expect(b.rival().energy.fuel.known).toBe(true);
    await b.finish();
  });

  it('the sidecar of a live session has realism.enabled, as the session ran with it', async () => {
    const b = live();
    b.push(session(77n, 0));
    b.uiState.apply({ kind: 'realism.set', enabled: true });
    b.push(session(78n, 60_000));
    await b.finish();
    const files = b.files();
    expect(files).toHaveLength(2);
    expect(sidecarOf(byUid(files, '000000000000004d'))).toEqual({ realism: { enabled: false } });
    expect(sidecarOf(byUid(files, '000000000000004e'))).toEqual({ realism: { enabled: true } });
  });

  it('without realismNextSession the run config decides, and the sidecar shows it', async () => {
    const dir = tmp();
    const hub = new TopicHub({ now: () => 0 });
    const source = new ManualSource(F);
    const pipeline = new FeedPipeline({
      feedId: F, source, hub, features, log, config: { realism: { enabled: true } },
      storage: { db: openDatabase(join(dir, 'p.db')), recordingsDir: dir },
    });
    pipeline.start();
    for (const p of session(77n, 0)) source.push(p.bytes, p.receivedAtMs);
    await pipeline.stop();
    const file = readdirSync(dir).find((n) => n.endsWith('.pwrec.gz'))!;
    expect(sidecarOf(join(dir, file))).toEqual({ realism: { enabled: true } });
  });
});

describe('replays reproduce realism', () => {
  /** Replays `file` with `config`, as `reprocess` and `replay` do, and keeps the final car and session values. */
  async function replay(file: string, config: ReturnType<typeof recordingConfig>) {
    const hub = new TopicHub({ now: () => 0 });
    const last = new Map<string, any>();
    hub.addClient('c', { send: (m: ServerMessage) => { if ((m.type === 'snapshot' || m.type === 'update') && 'value' in m) last.set(m.id, m.value); }, bufferedAmount: () => 0 });
    hub.subscribe({ clientId: 'c', id: 'info', topic: 'session.info', params: {}, feedId: F });
    hub.subscribe({ clientId: 'c', id: 'rival', topic: 'car.detail', params: { carId: 3 }, feedId: F });
    const pipeline = new FeedPipeline({ feedId: F, source: new PwrecSource({ feedId: F, path: file, mode: 'asFastAsPossible' }), hub, features, log, config });
    pipeline.start();
    await pipeline.done;
    hub.tick();
    return { info: last.get('info') as SessionInfo, rival: last.get('rival') as CarState };
  }

  async function liveRealismFile() {
    const b = live();
    b.uiState.apply({ kind: 'realism.set', enabled: true });
    b.push(session(77n, 0));
    const liveRival = b.rival();
    await b.finish();
    return { file: b.files()[0]!, liveRival, features };
  }

  it('the replay with the session\'s sidecar masks the same values as the live session did', async () => {
    const { file, liveRival } = await liveRealismFile();
    const config = recordingConfig(file, features, effectiveConfig(features));
    expect(config).toEqual({ realism: { enabled: true } });
    const r = await replay(file, config);
    expect(r.info.realism).toBe(true);
    expect(r.rival.energy.fuel).toEqual(REALISM);
    // the replay hub's clock is frozen, so time stamps differ; the values themselves are reproduced
    for (const key of ['energy', 'tyres', 'condition', 'dynamics'] as const) expect(r.rival[key]).toEqual(liveRival[key]);
  });

  it('the replay without a sidecar (default config) shows the rival unmasked', async () => {
    const { file } = await liveRealismFile();
    const r = await replay(file, effectiveConfig(features));
    expect(r.info.realism).toBe(false);
    expect(r.rival.energy.fuel.known).toBe(true);
  });

  it('the determinism hash of a realism recording is stable and follows the sidecar', async () => {
    const { file } = await liveRealismFile();
    const a = await topicStreamHash(file, { features }), b = await topicStreamHash(file, { features });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    // the same recording without its sidecar replays unmasked, so another stream
    const bare = tmp();
    const copy = join(bare, 'x.pwrec.gz');
    copyFileSync(file, copy);
    expect(await topicStreamHash(copy, { features })).not.toBe(a);
    // and a copy that keeps its sidecar hashes like the original
    const kept = tmp();
    const copy2 = join(kept, 'y.pwrec.gz');
    copyFileSync(file, copy2);
    copyFileSync(sessionConfigPath(file), sessionConfigPath(copy2));
    expect(await topicStreamHash(copy2, { features })).toBe(a);
  });
});
