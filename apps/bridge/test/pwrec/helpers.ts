// apps/bridge/test/pwrec/helpers.ts — builds .pwrec byte streams and drains readPwrec in tests
import { readFileSync } from 'node:fs';
import { constants, gunzipSync } from 'node:zlib';
import { readPwrec } from '../../src/pwrec/reader.ts';

const enc = new TextEncoder();
export const META = { recorderVersion: '0.1.0', startedAt: '2026-10-27T21:50:28.331Z', listenPort: 20777 };
export function pwrecHeader(meta: unknown = META, o: { magic?: string; version?: number; json?: string } = {}): Uint8Array {
  const json = enc.encode(o.json ?? JSON.stringify(meta));
  const out = new Uint8Array(10 + json.length);
  out.set(enc.encode(o.magic ?? 'PWREC'), 0);
  out[5] = o.version ?? 1;
  new DataView(out.buffer).setUint32(6, json.length, true);
  out.set(json, 10);
  return out;
}
export function pwrecRecord(kind: number, t: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(11 + payload.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, kind); v.setFloat64(1, t, true); v.setUint16(9, payload.length, true);
  out.set(payload, 11);
  return out;
}
export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};
/** Every record of a `.pwrec.gz` file, of every kind, as its decompressed stream holds it (leniently, like the readers). */
export function rawRecords(path: string): Array<{ kind: number; t: number; payload: Uint8Array }> {
  const bytes = gunzipSync(readFileSync(path), { finishFlush: constants.Z_SYNC_FLUSH });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 10 + view.getUint32(6, true);
  const out = [];
  while (bytes.length - at >= 11) {
    const len = view.getUint16(at + 9, true);
    if (at + 11 + len > bytes.length) break;
    out.push({ kind: view.getUint8(at), t: view.getFloat64(at + 1, true), payload: new Uint8Array(bytes.subarray(at + 11, at + 11 + len)) });
    at += 11 + len;
  }
  return out;
}
/** The resume record (kind 1) of a restart at `wallClockMs`: its payload is the restart's ISO 8601 wall time, UTF-8. */
export const resumeRecord = (t: number, wallClockMs: number): Uint8Array => pwrecRecord(1, t, enc.encode(new Date(wallClockMs).toISOString()));
export async function drain(path: string) {
  const it = readPwrec(path);
  const records = [];
  for (;;) { const r = await it.next(); if (r.done) return { records, summary: r.value }; records.push(r.value); }
}
