import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { WsClient } from '../../src/ws/client.ts';
import { SEGMENT, startCli } from '../helpers/cli.ts';

// Needs `catalogue.generated.json` at the repo root (`pnpm gen` writes it), as the running bridge reads it.
type Catalogue = { widgets: unknown[]; topics: Array<{ name: string }>; features: unknown[] };
const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-dev-'));
const until = async (done: () => boolean, ms: number) => {
  const t0 = Date.now();
  while (!done() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
};
const open: Array<{ stop: () => Promise<unknown> }> = [];
afterEach(async () => { for (const c of open.splice(0)) await c.stop(); });

async function replayWith(flags: string[]) {
  const replay = startCli(['replay', SEGMENT, '--realtime', ...flags], { PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: tmp() });
  open.push(replay);
  const [, port] = (await replay.waitFor(/listening ws:\/\/127\.0\.0\.1:(\d+)/))!;
  const client = WsClient.connect(`ws://127.0.0.1:${port}`);
  const messages: ServerMessage[] = [];
  client.subscribe('dev.catalogue' as TopicName, {}, (m) => messages.push(m));
  return { messages, close: () => client.close() };
}

describe('pitwall replay --dev: dev.catalogue', { timeout: 45_000 }, () => {
  it('publishes the catalogue (widgets, topics, features)', async () => {
    const { messages, close } = await replayWith(['--dev']);
    const values = () => messages.flatMap((m) => (m.type === 'snapshot' || m.type === 'update' ? [m.value as Catalogue] : []));
    await until(() => values().length > 0, 20_000);
    close();
    const catalogue = values()[0]!;
    expect(Array.isArray(catalogue.widgets)).toBe(true);
    expect(Array.isArray(catalogue.features)).toBe(true);
    expect(catalogue.topics.map((t) => t.name)).toContain('dev.catalogue');
    expect(catalogue.topics.map((t) => t.name)).toContain('feed.status');
  });

  it('without --dev: noData, never a value', async () => {
    const { messages, close } = await replayWith([]);
    await until(() => messages.length > 0, 10_000);
    await new Promise((r) => setTimeout(r, 1000));
    close();
    expect(messages.some((m) => m.type === 'topicStatus' && m.status === 'noData')).toBe(true);
    expect(messages.some((m) => m.type === 'snapshot' || m.type === 'update')).toBe(false);
  });
});
