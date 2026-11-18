// Ported from `serve-ended-qualifying.test.ts` (SP4.3d2 Task 5; the startup restore it tested is deleted with SP4.3e
// Task 7d, R3): a live `serve` writes each session's recording with the feed's UDP port as its meta `listenPort` (C58,
// the `.pwrec` format). The recording is of the committed segment qualifying-texas-send (C84), up to its SEND, in
// temporary data dirs.
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { decode, PacketId } from '@pitwall/protocol';
import { sessionRebuilder } from '../../src/cli/rebuild-database.ts';
import { serve } from '../../src/cli/serve.ts';
import { effectiveConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { readPwrec, readPwrecMeta } from '../../src/pwrec/reader.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { segmentPath } from '../fixtures/replay.ts';
import type { PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const RULES = 'unversioned';
const PORT = 20_777;
/** The serving process's monotonic clock starts elsewhere than the recording's. */
const SERVE_ORIGIN_MS = 7_000_000;
const tmp = () => mkdtempSync(join(tmpdir(), 'serve-listen-port-'));

const isSend = (p: PreparedPacket): boolean => {
  const decoded = decode(p.bytes);
  return decoded.ok && decoded.packet.packetId === PacketId.event && decoded.packet.details.code === 'SEND';
};
const shifted = (packets: readonly PreparedPacket[], firstAtMs: number): PreparedPacket[] =>
  packets.map((p) => ({ ...p, receivedAtMs: p.receivedAtMs - packets[0]!.receivedAtMs + firstAtMs }));
const recordingsOf = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz')).map((name) => join(dir, name)).sort();

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

describe('a live recording names its feed\'s port (C58)', { timeout: 120_000 }, () => {
  it('a live recording\'s meta holds the feed\'s port', async () => {
    const packets: PreparedPacket[] = [];
    for await (const r of readPwrec(segmentPath('qualifying-texas-send.pwrec.gz'))) packets.push({ bytes: r.payload, receivedAtMs: r.t });
    const dir = tmp();
    const recordingsDir = join(dir, 'recordings');
    mkdirSync(recordingsDir);
    const db = openDatabase(join(dir, 'live.db'));
    const source = new ManualSource(`udp-${PORT}` as FeedId);
    const out: string[] = [];
    const abort = new AbortController();
    const io = { out: (line: string) => out.push(line), err: () => {}, env: {}, signal: abort.signal };
    const done = serve({
      sources: [{ source, port: PORT, feed: { kind: 'udp', label: `UDP port ${PORT}` } as const }],
      wsPort: 0,
      dumpsDir: join(tmp(), 'dumps'),
      storage: { db, recordingsDir, rulesVersion: RULES, rebuild: sessionRebuilder(db, effectiveConfig(FEATURES), io, RULES) },
      staleCheck: { clock: () => SERVE_ORIGIN_MS, everyMs: 500 },
      io,
    });
    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      abort.abort();
      await done;
    };
    cleanup.push(stop);
    await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 60_000 });
    for (const p of shifted(packets.slice(0, packets.findIndex(isSend)), SERVE_ORIGIN_MS)) source.push(p.bytes, p.receivedAtMs);
    await vi.waitFor(() => expect(recordingsOf(recordingsDir)).toHaveLength(1), { timeout: 30_000 });
    await stop();
    const [file] = recordingsOf(recordingsDir);
    expect(readPwrecMeta(file!).listenPort).toBe(PORT);
  });
});
