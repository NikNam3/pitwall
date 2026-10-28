import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FeedId } from '@pitwall/domain';
import { describe, expect, it, vi } from 'vitest';
import type { RawPacket } from '../../src/input/packet-source.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { PwrecFormatError } from '../../src/pwrec/reader.ts';
import { PwrecWriter } from '../../src/pwrec/writer.ts';
import { META } from '../pwrec/helpers.ts';

const FEED = 'feed-a' as FeedId;
async function recording(ts: number[]): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), 'src-')), 'r.pwrec.gz');
  const w = PwrecWriter.create(path, META);
  ts.forEach((t, i) => w.write(t, new Uint8Array([i])));
  await w.close((ts.at(-1) ?? 0) + 1);
  return path;
}

describe('PwrecSource', () => {
  it('asFastAsPossible: every datagram in order, receivedAtMs = record t, no sleeping, then done', async () => {
    const sleep = vi.fn();
    const src = new PwrecSource({ feedId: FEED, path: await recording([100, 110, 110, 150]), mode: 'asFastAsPossible', sleep });
    const got: RawPacket[] = [];
    src.start((p) => got.push(p));
    await src.done;
    expect(got.map((p) => [p.feedId, p.receivedAtMs, [...p.bytes]])).toEqual([[FEED, 100, [0]], [FEED, 110, [1]], [FEED, 110, [2]], [FEED, 150, [3]]]);
    expect(sleep).not.toHaveBeenCalled();
  });
  it('realtime: sleeps the gaps relative to the first record', async () => {
    let now = 5_000;
    const sleeps: number[] = [];
    const src = new PwrecSource({ feedId: FEED, path: await recording([100, 110, 110, 150]), mode: 'realtime',
      clock: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    const got: number[] = [];
    src.start((p) => got.push(p.receivedAtMs));
    await src.done;
    expect(sleeps).toEqual([10, 40]);
    expect(got).toEqual([100, 110, 110, 150]);
  });
  it('realtime: never sleeps when the consumer is behind schedule', async () => {
    let now = 0;
    const sleep = vi.fn(async () => {});
    const src = new PwrecSource({ feedId: FEED, path: await recording([0, 10, 20]), mode: 'realtime', clock: () => now, sleep });
    src.start(() => { now += 100; });
    await src.done;
    expect(sleep).not.toHaveBeenCalled();
  });
  it('stop() aborts a pending realtime wait and resolves done', async () => {
    const sleep = (_ms: number, signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    const src = new PwrecSource({ feedId: FEED, path: await recording([0, 60_000]), mode: 'realtime', sleep });
    const got: RawPacket[] = [];
    src.start((p) => got.push(p));
    await vi.waitFor(() => expect(got).toHaveLength(1));
    await src.stop();
    await expect(src.done).resolves.toBeUndefined();
    expect(got).toHaveLength(1);
  });
  it('stop() from inside onPacket delivers nothing after that packet', async () => {
    const src = new PwrecSource({ feedId: FEED, path: await recording([0, 1, 2, 3, 4]), mode: 'asFastAsPossible' });
    const got: RawPacket[] = [];
    src.start((p) => { got.push(p); if (got.length === 2) void src.stop(); });
    await src.done;
    expect(got).toHaveLength(2);
  });
  it('done rejects with PwrecFormatError for a file with a bad magic', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'src-')), 'bad.pwrec.gz');
    writeFileSync(path, gzipSync(Buffer.from('NOPE!\x01\x00\x00\x00\x00')));
    const src = new PwrecSource({ feedId: FEED, path, mode: 'asFastAsPossible' });
    src.start(() => {});
    await expect(src.done).rejects.toBeInstanceOf(PwrecFormatError);
  });
});
