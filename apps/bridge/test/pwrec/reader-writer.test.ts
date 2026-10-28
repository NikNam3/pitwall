import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { PwrecFormatError } from '../../src/pwrec/reader.ts';
import { PwrecWriter } from '../../src/pwrec/writer.ts';
import { META, concat, drain, pwrecHeader, pwrecRecord } from './helpers.ts';
const tmp = () => mkdtempSync(join(tmpdir(), 'pwrec-'));
const payload = (n: number) => new Uint8Array([n, n + 1, n + 2]);

describe('readPwrec', () => {
  it('reads a gzip file and returns the summary', async () => {
    const path = join(tmp(), 'a.pwrec.gz');
    writeFileSync(path, gzipSync(concat(pwrecHeader(), pwrecRecord(0, 1, payload(1)), pwrecRecord(255, 9))));
    expect(await drain(path)).toEqual({ records: [{ kind: 0, t: 1, payload: payload(1) }], summary: { meta: META, endedCleanly: true, durationMs: 9 } });
  });
  it('throws PwrecFormatError for a bad magic', async () => {
    const path = join(tmp(), 'bad.pwrec.gz');
    writeFileSync(path, gzipSync(pwrecHeader(META, { magic: 'NOPE!' })));
    await expect(drain(path)).rejects.toSatisfy((e) => e instanceof PwrecFormatError && e.error.kind === 'badMagic');
  });
});

describe('PwrecWriter', () => {
  it('round-trips through readPwrec, unknown meta fields included', async () => {
    const path = join(tmp(), 'w.pwrec.gz');
    const meta = { ...META, forwarder: 'x' };
    const w = PwrecWriter.create(path, meta);
    [0, 400, 1200].forEach((t, i) => w.write(t, payload(i)));
    await w.close(2500);
    expect(await drain(path)).toEqual({
      records: [0, 400, 1200].map((t, i) => ({ kind: 0, t, payload: payload(i) })),
      summary: { meta, endedCleanly: true, durationMs: 2500 },
    });
    expect(() => w.write(3000, payload(9))).toThrow();
  });
  it('a crash after a sync flush leaves a readable file without end marker', async () => {
    const path = join(tmp(), 'crash.pwrec.gz');
    const w = PwrecWriter.create(path, META);
    const ts = [0, 400, 800, 1200, 1600, 2100, 2300];   // flushes after 1200 and after 2100
    ts.forEach((t, i) => w.write(t, payload(i)));
    await w.close(2400);
    const file = readFileSync(path);
    const lastFlush = file.subarray(0, file.length - 8).lastIndexOf(Buffer.from([0, 0, 0xff, 0xff]));
    writeFileSync(path, file.subarray(0, lastFlush + 4));   // simulate kill right after the 2100 flush
    const { records, summary } = await drain(path);
    expect(records.map((r) => r.t)).toEqual([0, 400, 800, 1200, 1600, 2100]);
    expect(summary).toEqual({ meta: META, endedCleanly: false });
  });
  it('reports file errors through onError and close()', async () => {
    const onError = vi.fn();
    const w = PwrecWriter.create(join(tmp(), 'missing-dir', 'x.pwrec.gz'), META, { onError });
    w.write(0, payload(0));
    await expect(w.close(1)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(onError).toHaveBeenCalledOnce();
  });
});
