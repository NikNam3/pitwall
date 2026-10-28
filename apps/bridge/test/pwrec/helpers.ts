// apps/bridge/test/pwrec/helpers.ts — builds .pwrec byte streams and drains readPwrec in tests
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
export async function drain(path: string) {
  const it = readPwrec(path);
  const records = [];
  for (;;) { const r = await it.next(); if (r.done) return { records, summary: r.value }; records.push(r.value); }
}
