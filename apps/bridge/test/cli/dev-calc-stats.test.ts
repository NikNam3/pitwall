import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { WsClient } from '../../src/ws/client.ts';
import { SEGMENT, startCli } from '../helpers/cli.ts';

type Stat = { id: string; lastMs: number; meanMs: number; runs: number; lastSessionTime: number };
const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-dev-'));
const until = async (done: () => boolean, ms: number) => {
  const t0 = Date.now();
  while (!done() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
};

const open: Array<{ stop: () => Promise<unknown> }> = [];
afterEach(async () => { for (const c of open.splice(0)) await c.stop(); });

/** Replays the Zandvoort segment at the recorded pace (so calculators run on demand) and subscribes to session.info and dev.calcStats. */
async function replayWith(flags: string[]) {
  const replay = startCli(['replay', SEGMENT, '--realtime', ...flags], { PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: tmp() });
  open.push(replay);
  const [, port] = (await replay.waitFor(/listening ws:\/\/127\.0\.0\.1:(\d+)/))!;
  const client = WsClient.connect(`ws://127.0.0.1:${port}`);
  const stats: ServerMessage[] = [];
  client.subscribe('session.info' as TopicName, {}, () => {});
  client.subscribe('dev.calcStats' as TopicName, {}, (m) => stats.push(m));
  return { stats, close: () => client.close() };
}

describe('pitwall replay --dev', { timeout: 45_000 }, () => {
  it('publishes dev.calcStats with an entry for session.info', async () => {
    const { stats, close } = await replayWith(['--dev']);
    const entries = () => stats.flatMap((m) => (m.type === 'snapshot' || m.type === 'update' ? [m.value as Stat[] | undefined] : [])).filter((v): v is Stat[] => Array.isArray(v));
    await until(() => entries().some((list) => list.some((s) => s.id === 'session.info')), 20_000);
    close();
    const entry = entries().flat().find((s) => s.id === 'session.info');
    expect(entry).toBeDefined();
    expect(entry!.runs).toBeGreaterThanOrEqual(1);
    expect(entry!.lastMs).toBeGreaterThanOrEqual(0);
    expect(entry!.meanMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(entry!.lastMs) && Number.isFinite(entry!.meanMs)).toBe(true);
    expect(Number.isInteger(entry!.lastSessionTime)).toBe(true);
  });

  it('without --dev the topic is never published: a subscriber gets noData', async () => {
    const { stats, close } = await replayWith([]);
    await until(() => stats.length > 0, 10_000);
    await new Promise((r) => setTimeout(r, 2500)); // longer than the 1 Hz publish interval
    close();
    expect(stats.some((m) => m.type === 'topicStatus' && m.status === 'noData')).toBe(true);
    expect(stats.some((m) => m.type === 'snapshot' || m.type === 'update')).toBe(false);
  });
});
