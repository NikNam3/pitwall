// `serve` wires the hub's one demand callback to the pipeline: a client that subscribes while a session runs
// gets the topic's calculator started, although nothing subscribed to it when the session began.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { serve } from '../../src/cli/serve.ts';
import { WsClient } from '../../src/ws/client.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const F = 'live' as FeedId;

describe('serve: demand reaches the pipeline', () => {
  it('a client subscribing to cars.overview mid-session receives its value from the running session', async () => {
    const source = new ManualSource(F);
    const out: string[] = [];
    const abort = new AbortController();
    const done = serve({
      source, feed: { kind: 'replay', label: 'test' }, wsPort: 0, dumpsDir: mkdtempSync(join(tmpdir(), 'demand-')),
      io: { out: (line) => out.push(line), err: () => {}, env: {}, signal: abort.signal },
    });
    await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/));
    const port = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))![1];

    const builder = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).frames(10, () => {});
    const first = builder.packets().length;
    builder.frames(40, () => {});
    const packets = builder.packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
    packets.slice(0, first).forEach((p) => source.push(p.bytes, p.receivedAtMs));

    const client = WsClient.connect(`ws://127.0.0.1:${port}`, { reconnectMs: 50 });
    const received: ServerMessage[] = [];
    client.subscribe('cars.overview', {}, (m) => received.push(m));
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0)); // the subscription is in: noData so far
    packets.slice(first).forEach((p) => source.push(p.bytes, p.receivedAtMs));

    await vi.waitFor(() => {
      const values = received.flatMap((m) => ((m.type === 'update' || m.type === 'snapshot') && 'value' in m ? [m.value] : []));
      expect(values.some((v) => Array.isArray(v) && v.length > 0)).toBe(true);
    });
    client.close();
    abort.abort();
    await expect(done).resolves.toBe(0);
  });
});
