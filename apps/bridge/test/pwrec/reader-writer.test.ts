import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { PwrecFormatError } from '../../src/pwrec/reader.ts';
import { PwrecWriter } from '../../src/pwrec/writer.ts';
import { META, concat, drain, pwrecHeader, pwrecRecord, rawRecords, resumeRecord } from './helpers.ts';
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
  it('the file exists as soon as create returns', async () => {
    // A live session writes its config sidecar right after creating its file: the sidecar must never be on disk
    // without the file (an asynchronous open left a window that the CLI's config test saw under load).
    const path = join(tmp(), 'now.pwrec.gz');
    const w = PwrecWriter.create(path, META);
    expect(existsSync(path)).toBe(true);
    await w.close(0);
    expect((await drain(path)).summary).toEqual({ meta: META, endedCleanly: true, durationMs: 0 });
  });
  it('reports file errors through onError and close()', async () => {
    const onError = vi.fn();
    const w = PwrecWriter.create(join(tmp(), 'missing-dir', 'x.pwrec.gz'), META, { onError });
    w.write(0, payload(0));
    await expect(w.close(1)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(onError).toHaveBeenCalledOnce();
  });
});

// SP4.3c Task 10 (C59): a session's recording continues across bridge restarts. The record kind `1` is the resume record:
// its `t` keeps record times non-decreasing, its payload is the restart's ISO 8601 wall time (UTF-8). Readers read past
// it, and past an end record that is not the file's last (a bridge that stopped cleanly before the restart).
describe('readPwrec across a restart', () => {
  const STARTED = Date.parse(META.startedAt);
  it('reads past a mid-file end record and a resume record; the summary is the last part\'s', async () => {
    const path = join(tmp(), 'continued.pwrec.gz');
    writeFileSync(path, gzipSync(concat(pwrecHeader(), pwrecRecord(0, 0, payload(0)), pwrecRecord(0, 10, payload(1)), pwrecRecord(255, 11),
      resumeRecord(60_000, STARTED + 60_000), pwrecRecord(0, 60_000, payload(2)), pwrecRecord(0, 60_010, payload(3)), pwrecRecord(255, 60_011))));
    expect(await drain(path)).toEqual({
      records: [[0, 0], [10, 1], [60_000, 2], [60_010, 3]].map(([t, n]) => ({ kind: 0, t, payload: payload(n!) })),
      summary: { meta: META, endedCleanly: true, durationMs: 60_011 },
    });
  });
  it('a continued file whose last part was cut off did not end cleanly', async () => {
    const path = join(tmp(), 'continued-cut.pwrec.gz');
    writeFileSync(path, gzipSync(concat(pwrecHeader(), pwrecRecord(0, 0, payload(0)), pwrecRecord(255, 1),
      resumeRecord(5_000, STARTED + 5_000), pwrecRecord(0, 5_000, payload(1)))));
    const { records, summary } = await drain(path);
    expect(records.map((r) => r.t)).toEqual([0, 5_000]);
    expect(summary).toEqual({ meta: META, endedCleanly: false });
  });
});

describe('PwrecWriter.resume', () => {
  const STARTED = Date.parse(META.startedAt);
  /** A file the recorder was killed in mid-record: three whole datagrams, then 7 bytes of a fourth. */
  const cutMidRecord = (): string => {
    const path = join(tmp(), 'cut.pwrec.gz');
    writeFileSync(path, gzipSync(concat(pwrecHeader(), pwrecRecord(0, 0, payload(0)), pwrecRecord(0, 400, payload(1)), pwrecRecord(0, 1200, payload(2)),
      pwrecRecord(0, 1500, payload(3)).subarray(0, 7))));
    return path;
  };

  it('a file cut mid-record: trims to its last whole record (count returned), appends the resume record, then appends as usual', async () => {
    const path = cutMidRecord();
    const wallClockMs = STARTED + 90_000;
    const { writer, records, resumeT } = await PwrecWriter.resume(path, { wallClockMs });
    expect(records).toBe(3);
    // the previous last t (1200) plus the wall-time gap since it (90 000 - 1200)
    expect(resumeT).toBe(90_000);
    writer.write(90_000, payload(4));
    writer.write(90_016, payload(5));
    await writer.close(90_020);
    // recompressed: one valid gzip stream, readable without leniency
    expect(() => gunzipSync(readFileSync(path))).not.toThrow();
    const raw = rawRecords(path);
    expect(raw.map((r) => [r.kind, r.t])).toEqual([[0, 0], [0, 400], [0, 1200], [1, 90_000], [0, 90_000], [0, 90_016], [255, 90_020]]);
    expect(new TextDecoder().decode(raw[3]!.payload)).toBe(new Date(wallClockMs).toISOString());
    expect(await drain(path)).toEqual({
      records: [[0, 0], [400, 1], [1200, 2], [90_000, 4], [90_016, 5]].map(([t, n]) => ({ kind: 0, t, payload: payload(n!) })),
      summary: { meta: META, endedCleanly: true, durationMs: 90_020 },
    });
  });
  it('keeps record times non-decreasing when the wall clock is behind the file\'s last record', async () => {
    const path = cutMidRecord();
    const { writer, records, resumeT } = await PwrecWriter.resume(path, { wallClockMs: STARTED + 100 });
    expect([records, resumeT]).toEqual([3, 1200]);
    writer.write(1200, payload(4));
    await writer.close(1201);
    const ts = rawRecords(path).map((r) => r.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(rawRecords(path).map((r) => r.kind)).toEqual([0, 0, 0, 1, 0, 255]);
  });
  it('a file the writer was killed in after a sync flush resumes after its last flushed record', async () => {
    const path = join(tmp(), 'killed.pwrec.gz');
    const w = PwrecWriter.create(path, META);
    [0, 400, 800, 1200, 1600, 2100, 2300].forEach((t, i) => w.write(t, payload(i)));   // flushes after 1200 and after 2100
    await w.close(2400);
    const file = readFileSync(path);
    const lastFlush = file.subarray(0, file.length - 8).lastIndexOf(Buffer.from([0, 0, 0xff, 0xff]));
    writeFileSync(path, file.subarray(0, lastFlush + 4));
    const { writer, records, resumeT } = await PwrecWriter.resume(path, { wallClockMs: STARTED + 10_000 });
    expect([records, resumeT]).toEqual([6, 10_000]);
    writer.write(10_000, payload(9));
    await writer.close(10_001);
    const { records: read, summary } = await drain(path);
    expect(read.map((r) => r.t)).toEqual([0, 400, 800, 1200, 1600, 2100, 10_000]);
    expect(summary).toEqual({ meta: META, endedCleanly: true, durationMs: 10_001 });
  });
  it('a file closed cleanly (the bridge stopped) resumes with every datagram, its meta unchanged', async () => {
    const path = join(tmp(), 'stopped.pwrec.gz');
    const meta = { ...META, forwarder: 'x' };
    const w = PwrecWriter.create(path, meta);
    [0, 400].forEach((t, i) => w.write(t, payload(i)));
    await w.close(500);
    const { writer, records, resumeT } = await PwrecWriter.resume(path, { wallClockMs: STARTED + 3_000 });
    expect([records, resumeT]).toEqual([2, 3_000]);
    writer.write(3_000, payload(2));
    await writer.close(3_001);
    expect(await drain(path)).toEqual({
      records: [[0, 0], [400, 1], [3_000, 2]].map(([t, n]) => ({ kind: 0, t, payload: payload(n!) })),
      summary: { meta, endedCleanly: true, durationMs: 3_001 },
    });
  });
  it('a file that cannot be read rejects with PwrecFormatError and leaves the file as it was', async () => {
    const path = join(tmp(), 'bad.pwrec.gz');
    const bytes = gzipSync(pwrecHeader(META, { magic: 'NOPE!' }));
    writeFileSync(path, bytes);
    await expect(PwrecWriter.resume(path, { wallClockMs: STARTED })).rejects.toBeInstanceOf(PwrecFormatError);
    expect(readFileSync(path)).toEqual(Buffer.from(bytes));
  });
});
