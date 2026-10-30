// ReplayController on the committed race-zandvoort-lap10 segment (spec 8.5, Task 5). Time is injected: the test releases the pacer's sleeps.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReplayStatus } from '@pitwall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { ReplayController } from '../../src/replay/replay-controller.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { FEED, harness, tick, until } from './harness.ts';

const SEGMENT = join(import.meta.dirname, '../../../../fixtures/segments/race-zandvoort-lap10.pwrec.gz');
const open: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of open.splice(0)) await stop(); });
const start = () => { const h = harness(SEGMENT); open.push(h.stop); return h; };

/** The session-time range of the segment (a mid-session cut, so it does not start at 0): first and last frame of a plain fast replay. */
async function rangeOfSegment(): Promise<{ start: number; end: number; frac: (fraction: number) => number }> {
  const source = new PwrecSource({ feedId: FEED, path: SEGMENT, mode: 'asFastAsPossible' });
  const pipeline = new FeedPipeline({ feedId: FEED, source, hub: new TopicHub({ now: () => performance.now() }), features: FEATURES, log: createLogger({ level: 'silent' }) });
  let start: number | undefined;
  const original = source.start.bind(source);
  source.start = (onPacket) => original((packet) => { onPacket(packet); start ??= pipeline.position()?.sessionTimeMs; });
  pipeline.start();
  await pipeline.done;
  const end = pipeline.position()!.sessionTimeMs;
  expect(start).toBeDefined();
  expect(end).toBeGreaterThan(start! + 2000);
  return { start: start!, end, frac: (fraction) => Math.floor(start! + (end - start!) * fraction) };
}
const endOfSegment = async (): Promise<number> => (await rangeOfSegment()).end;

describe('ReplayController: pause, play, speed', () => {
  it('starts playing; pause stops the session time from advancing, play resumes it', async () => {
    const h = start();
    await h.pumpUntil(() => (h.controller.position()?.sessionTimeMs ?? 0) > 0);
    h.controller.control({ kind: 'pause' });
    await h.pump(30);
    const frozen = h.controller.position()!.sessionTimeMs;
    const sleepsWhilePaused = h.gate.requested.length;
    await h.pump(150);
    expect(h.controller.position()!.sessionTimeMs).toBe(frozen);
    expect(h.gate.requested.length).toBe(sleepsWhilePaused);
    expect(h.status()).toMatchObject({ paused: true, atEnd: false, sessionTimeMs: frozen });
    h.controller.control({ kind: 'play' });
    await h.pumpUntil(() => h.controller.position()!.sessionTimeMs > frozen + 500);
    expect(h.status()).toMatchObject({ paused: false, speed: 1 });
  });
  it('speed 4 asks the clock for a quarter of the waits speed 1 does, for the same records', async () => {
    const waits = async (factor: number): Promise<number[]> => {
      const h = start();
      h.controller.control({ kind: 'pause' }); // before the first record is read
      h.controller.control({ kind: 'speed', factor });
      h.controller.control({ kind: 'play' });
      await h.pumpUntil(() => h.gate.requested.length >= 60);
      expect(h.status()).toMatchObject({ speed: factor });
      await h.stop();
      return h.gate.requested.slice(0, 60);
    };
    const normal = await waits(1);
    const fast = await waits(4);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(normal)).toBeGreaterThan(200);
    expect(sum(fast) / sum(normal)).toBeGreaterThan(0.2);
    expect(sum(fast) / sum(normal)).toBeLessThan(0.3);
  });
  it('a speed set while playing applies to the waits that follow', async () => {
    const h = start();
    await h.pumpUntil(() => h.gate.requested.length >= 40);
    h.controller.control({ kind: 'speed', factor: 8 });
    await h.pump(3); // in-flight waits were asked before the change
    const from = h.gate.requested.length;
    await h.pumpUntil(() => h.gate.requested.length >= from + 40);
    const after = h.gate.requested.slice(from, from + 40);
    const before = h.gate.requested.slice(0, 40);
    expect(Math.max(...after)).toBeLessThanOrEqual(Math.max(...before) / 8 + 1);
  });
});

describe('ReplayController: jumps', () => {
  it('jumpToTime forward fast-forwards without waiting and keeps the paused state', async () => {
    const { end, frac } = await rangeOfSegment();
    const target = frac(0.5);
    const h = start();
    h.controller.control({ kind: 'pause' });
    h.controller.control({ kind: 'jumpToTime', sessionTimeMs: target });
    await until(() => (h.controller.position()?.sessionTimeMs ?? 0) >= target);
    await tick();
    expect(h.gate.requested).toEqual([]);
    expect(h.controller.position()!.sessionTimeMs).toBeLessThan(end);
    const at = h.controller.position()!.sessionTimeMs;
    await h.pump(60);
    expect(h.controller.position()!.sessionTimeMs).toBe(at);
    expect(h.status()).toMatchObject({ paused: true, atEnd: false, sessionTimeMs: at });
  });
  it('jumpToTime forward from playing goes on playing afterwards', async () => {
    const { frac } = await rangeOfSegment();
    const target = frac(0.6);
    const h = start();
    await h.pump(5);
    h.controller.control({ kind: 'jumpToTime', sessionTimeMs: target });
    await until(() => (h.controller.position()?.sessionTimeMs ?? 0) >= target, h.gate.releaseAll);
    const at = h.controller.position()!.sessionTimeMs;
    await h.pumpUntil(() => h.controller.position()!.sessionTimeMs > at + 200);
    expect(h.status()).toMatchObject({ paused: false });
  });
  it('jumpToTime backward resets the feed and replays from the start to the target', async () => {
    const { frac } = await rangeOfSegment();
    const late = frac(0.75);
    const early = frac(0.25);
    const h = start();
    const reset = vi.spyOn(h.hub, 'resetFeed');
    h.controller.control({ kind: 'pause' });
    h.controller.control({ kind: 'jumpToTime', sessionTimeMs: late });
    await until(() => (h.controller.position()?.sessionTimeMs ?? 0) >= late);
    const resetsForward = reset.mock.calls.filter(([f]) => f === FEED).length;
    h.controller.control({ kind: 'jumpToTime', sessionTimeMs: early });
    await until(() => { const t = h.controller.position()?.sessionTimeMs; return t !== undefined && t >= early && t < late; });
    expect(reset.mock.calls.filter(([f]) => f === FEED).length).toBeGreaterThan(resetsForward);
    expect(h.gate.requested).toEqual([]);
    expect(h.status()).toMatchObject({ paused: true, atEnd: false });
  });
  it('a backward jump leaves the same session.info and cars.overview as a fresh replay fast-forwarded to the target', async () => {
    const { frac } = await rangeOfSegment();
    const late = frac(0.8);
    const early = frac(0.3);
    const jumped = start();
    jumped.controller.control({ kind: 'pause' });
    jumped.controller.control({ kind: 'jumpToTime', sessionTimeMs: late });
    await until(() => (jumped.controller.position()?.sessionTimeMs ?? 0) >= late);
    jumped.controller.control({ kind: 'jumpToTime', sessionTimeMs: early });
    await until(() => { const t = jumped.controller.position()?.sessionTimeMs; return t !== undefined && t >= early && t < late; });
    await tick();
    const fresh = start();
    fresh.controller.control({ kind: 'pause' });
    fresh.controller.control({ kind: 'jumpToTime', sessionTimeMs: early });
    await until(() => (fresh.controller.position()?.sessionTimeMs ?? 0) >= early);
    await tick();
    expect(jumped.controller.position()).toEqual(fresh.controller.position());
    const info = fresh.read('session.info');
    const cars = fresh.read('cars.overview');
    expect(info).toBeDefined();
    expect(cars).toBeDefined();
    expect(jumped.read('session.info')).toEqual(info);
    expect(jumped.read('cars.overview')).toEqual(cars);
  });
  it('jumpToLap 10 (past the line) then jumpToLap 9 gives the same session.info and cars.overview as a fresh replay jumped to lap 9', async () => {
    const jumpToLap = async (h: ReturnType<typeof start>, lap: number, notBefore?: (lap: number) => boolean) => {
      h.controller.control({ kind: 'jumpToLap', lap });
      await until(() => { const p = h.controller.position(); return p !== undefined && p.playerLap >= lap && (notBefore?.(p.playerLap) ?? true); });
    };
    const jumped = start();
    jumped.controller.control({ kind: 'pause' });
    await jumpToLap(jumped, 10);
    expect(jumped.controller.position()!.playerLap).toBe(10);
    await jumpToLap(jumped, 9, (lap) => lap < 10);
    await tick();
    const fresh = start();
    fresh.controller.control({ kind: 'pause' });
    await jumpToLap(fresh, 9);
    await tick();
    expect(jumped.controller.position()).toEqual(fresh.controller.position());
    expect(jumped.controller.position()!.playerLap).toBe(9);
    const info = fresh.read('session.info');
    const cars = fresh.read('cars.overview');
    expect(info).toBeDefined();
    expect(cars).toBeDefined();
    expect(jumped.read('session.info')).toEqual(info);
    expect(jumped.read('cars.overview')).toEqual(cars);
    expect(jumped.status()).toMatchObject({ paused: true, atEnd: false, playerLap: 9 });
    expect(jumped.gate.requested).toEqual([]);
  });
  it.each([
    ['jumpToLap 99', { kind: 'jumpToLap', lap: 99 }],
    ['jumpToTime far beyond the end', { kind: 'jumpToTime', sessionTimeMs: 10_000_000 }],
  ] as const)('%s stops at the last frame with atEnd and note beyondEnd, and does not hang', async (_name, control) => {
    const end = await endOfSegment();
    const h = start();
    h.controller.control(control);
    await until(() => h.status()?.atEnd === true, () => {}, 20_000);
    expect(h.status()).toMatchObject({ atEnd: true, note: 'beyondEnd', sessionTimeMs: end });
    expect(h.controller.position()!.sessionTimeMs).toBe(end);
  }, 30_000);
  it('after a jump beyond the end, a jump back works and clears atEnd and the note', async () => {
    const { end, frac } = await rangeOfSegment();
    const h = start();
    h.controller.control({ kind: 'pause' });
    h.controller.control({ kind: 'jumpToLap', lap: 99 });
    await until(() => h.status()?.atEnd === true, () => {}, 20_000);
    expect(h.status()).toMatchObject({ paused: true });
    const target = frac(0.25);
    h.controller.control({ kind: 'jumpToTime', sessionTimeMs: target });
    await until(() => { const s = h.status(); return s !== undefined && !s.atEnd && s.sessionTimeMs >= target && s.sessionTimeMs < end; }, () => {}, 20_000);
    const status = h.status()!;
    expect(status.note).toBeUndefined();
    expect(status.paused).toBe(true);
  }, 30_000);
});

describe('ReplayController: a failing recording', () => {
  it('an unreadable recording (not gzip) during a jump rejects done and settles settled() instead of hanging', async () => {
    const bad = join(mkdtempSync(join(tmpdir(), 'replay-bad-')), 'garbage.pwrec.gz');
    writeFileSync(bad, 'this is not a recording');
    const h = harness(bad);
    open.push(h.stop);
    h.controller.control({ kind: 'jumpToLap', lap: 5 });
    await expect(h.controller.done).rejects.toBeDefined();
    const outcome = await Promise.race([
      h.controller.settled().then(() => 'settled', () => 'settled'),
      new Promise<string>((r) => setTimeout(() => r('hung'), 5000)),
    ]);
    expect(outcome).toBe('settled');
  }, 15_000);
});

describe('ReplayController: replay.status before the first frame', () => {
  it('is not published until a frame exists: a subscriber gets noData, never sessionTimeMs 0', async () => {
    const h = start();
    h.controller.control({ kind: 'pause' });
    const got: Array<{ type: string; [k: string]: unknown }> = [];
    h.hub.addClient('early', { send: (m) => got.push(m as never), bufferedAmount: () => 0 });
    h.hub.subscribe({ clientId: 'early', id: 'x', topic: 'replay.status', params: {}, feedId: FEED });
    h.hub.tick();
    expect(got.some((m) => (m.type === 'snapshot' || m.type === 'update') && 'value' in m)).toBe(false);
    expect(h.status()).toBeUndefined();
    await until(() => h.controller.position() !== undefined);
    await tick();
    h.hub.tick();
    const values = got.filter((m) => (m.type === 'snapshot' || m.type === 'update') && 'value' in m).map((m) => m.value as { sessionTimeMs: number });
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v.sessionTimeMs > 0)).toBe(true);
  });
});

describe('ReplayController: replay.status', () => {
  it('publishes paused, speed, sessionTimeMs, playerLap and atEnd for the feed', async () => {
    const h = start();
    h.controller.control({ kind: 'pause' });
    h.controller.control({ kind: 'speed', factor: 2 });
    await h.pumpUntil(() => h.status() !== undefined);
    const status = h.status()!;
    expect(status).toMatchObject({ paused: true, speed: 2, atEnd: false });
    expect(Number.isInteger(status.sessionTimeMs)).toBe(true);
    expect(Number.isInteger(status.playerLap)).toBe(true);
    expect(status.note).toBeUndefined();
  });
  it('done settles once the recording is stopped', async () => {
    const h = start();
    await h.stop();
    await expect(h.controller.done).resolves.toBeUndefined();
  });
});

// Interface assumed (final fix wave): `controller.transport(): { paused: boolean; speed: number; unpaced: boolean }` is the one
// place the transport state lives (`serve` no longer tracks it); `replay.status` carries `unpaced: true` while the replay plays
// without waiting (the `pitwall replay` default), and nothing (no key) otherwise.
describe('ReplayController: transport accessor and unpaced status', () => {
  it('transport() follows pause, play and speed', async () => {
    const h = start();
    expect(h.controller.transport()).toEqual({ paused: false, speed: 1, unpaced: false });
    h.controller.control({ kind: 'pause' });
    h.controller.control({ kind: 'speed', factor: 4 });
    expect(h.controller.transport()).toEqual({ paused: true, speed: 4, unpaced: false });
    h.controller.control({ kind: 'play' });
    expect(h.controller.transport()).toEqual({ paused: false, speed: 4, unpaced: false });
  });
  it('a paced replay publishes no unpaced flag', async () => {
    const h = start();
    await h.pumpUntil(() => h.status() !== undefined);
    expect(h.status()).not.toHaveProperty('unpaced');
  });
  it('an unpaced replay reports unpaced honestly in transport() and replay.status, until the first speed control', async () => {
    const hub = new TopicHub({ now: () => performance.now() });
    const controller = new ReplayController({
      path: SEGMENT, feedId: FEED, hub, unpaced: true,
      makePipeline: (source) => new FeedPipeline({ feedId: FEED, source, hub, features: FEATURES, log: createLogger({ level: 'silent' }) }),
    });
    open.push(() => controller.stop());
    expect(controller.transport()).toMatchObject({ paused: false, unpaced: true });
    controller.control({ kind: 'speed', factor: 2 });
    expect(controller.transport()).toEqual({ paused: false, speed: 2, unpaced: false });
  });
});

// Bug B2: a lap jump is a fast-forward through the recording (about 17 times real time on the TT Zandvoort recording:
// lap 12 is 45 s away), and a jump back restarts at lap 1. `replay.status` showed only that progress, so the top bar's lap
// field fell back to the lap the fast-forward was on and the jump looked ignored. `jumpingTo` names the target while the
// jump is under way, and the status after it lands, paused or playing, no longer has it.
describe('ReplayController: replay.status while a jump is under way', () => {
  /** Every replay.status value an already subscribed client receives, as it arrives. */
  const subscribe = (h: ReturnType<typeof start>) => {
    const got: ReplayStatus[] = [];
    h.hub.addClient('ui', { send: (m) => { if ((m.type === 'snapshot' || m.type === 'update') && 'value' in m) got.push(m.value as ReplayStatus); }, bufferedAmount: () => 0 });
    h.hub.subscribe({ clientId: 'ui', id: 'rs', topic: 'replay.status', params: {}, feedId: FEED });
    return { last: () => { h.hub.tick(); return got.at(-1); }, all: got };
  };

  it('a forward jump while paused names its target until it lands, then the paused status drops it', async () => {
    const { frac } = await rangeOfSegment();
    const target = frac(0.5);
    const h = start();
    h.controller.control({ kind: 'pause' });
    await until(() => h.controller.position() !== undefined);
    const ui = subscribe(h);
    h.controller.control({ kind: 'jumpToTime', sessionTimeMs: target });
    expect(ui.last()?.jumpingTo).toEqual({ kind: 'time', sessionTimeMs: target });
    await until(() => (h.controller.position()?.sessionTimeMs ?? 0) >= target);
    await h.controller.settled();
    await tick();
    expect(ui.last()).toMatchObject({ paused: true });
    expect(ui.last()).not.toHaveProperty('jumpingTo');
  });

  it('a jump back names its target through the restart and the fast-forward from the start', async () => {
    const { frac } = await rangeOfSegment();
    const late = frac(0.75);
    const early = frac(0.25);
    const h = start();
    h.controller.control({ kind: 'pause' });
    h.controller.control({ kind: 'jumpToTime', sessionTimeMs: late });
    await until(() => (h.controller.position()?.sessionTimeMs ?? 0) >= late);
    await h.controller.settled();
    const ui = subscribe(h);
    const before = ui.all.length;
    h.controller.control({ kind: 'jumpToTime', sessionTimeMs: early });
    await h.controller.settled();
    await tick();
    const during = ui.all.slice(before, -1);
    expect(during.length).toBeGreaterThan(0);
    for (const status of during) expect(status.jumpingTo).toEqual({ kind: 'time', sessionTimeMs: early });
    expect(ui.last()).toMatchObject({ paused: true, atEnd: false });
    expect(ui.last()).not.toHaveProperty('jumpingTo');
    expect(ui.last()!.sessionTimeMs).toBeGreaterThanOrEqual(early);
  });

  it('a lap jump names the lap; one beyond the end drops it with the beyondEnd note', async () => {
    const h = start();
    await until(() => h.controller.position() !== undefined, h.gate.releaseAll);
    const ui = subscribe(h);
    h.controller.control({ kind: 'jumpToLap', lap: 99 });
    expect(ui.last()?.jumpingTo).toEqual({ kind: 'lap', lap: 99 });
    await until(() => h.status()?.atEnd === true, () => {}, 20_000);
    expect(ui.last()).toMatchObject({ atEnd: true, note: 'beyondEnd' });
    expect(ui.last()).not.toHaveProperty('jumpingTo');
  }, 30_000);
});
