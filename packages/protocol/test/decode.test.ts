import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PACKET_SIZES, PacketId, decode, encode, peekHeader, type PacketName } from '../src/index.ts';
import { arbitraryPacket } from './arbitraries.ts';

function raw(packetId: number, length: number, format = 2025): Uint8Array {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  if (length >= 2) view.setUint16(0, format, true);
  if (length >= 7) view.setUint8(6, packetId);
  return bytes;
}

describe('decode errors are values', () => {
  it('truncated below 29 bytes', () => {
    expect(decode(new Uint8Array(0))).toEqual({ ok: false, error: { kind: 'truncated', length: 0 } });
    expect(decode(raw(2, 28))).toEqual({ ok: false, error: { kind: 'truncated', length: 28 } });
  });
  it('wrongFormat carries the received format, checked before the size', () => {
    expect(decode(raw(2, 1285, 2024))).toEqual({ ok: false, error: { kind: 'wrongFormat', format: 2024 } });
    expect(decode(raw(2, 1239, 2024))).toEqual({ ok: false, error: { kind: 'wrongFormat', format: 2024 } });
  });
  it('unknownPacketId', () => {
    expect(decode(raw(16, 100))).toEqual({ ok: false, error: { kind: 'unknownPacketId', packetId: 16 } });
  });
  it('sizeMismatch in both directions', () => {
    expect(decode(raw(2, 1284))).toEqual({ ok: false, error: { kind: 'sizeMismatch', packetId: 2, expected: 1285, actual: 1284 } });
    expect(decode(raw(3, 46))).toEqual({ ok: false, error: { kind: 'sizeMismatch', packetId: 3, expected: 45, actual: 46 } });
  });
  it('unknownEventCode', () => {
    const bytes = raw(3, 45);
    bytes.set([65, 66, 67, 68], 29);
    expect(decode(bytes)).toEqual({ ok: false, error: { kind: 'unknownEventCode', code: 'ABCD' } });
  });
  it('a zero body decodes', () => {
    const r = decode(raw(15, 1131));
    expect(r.ok && r.packet.packetId).toBe(15);
  });
});

describe('round trip', () => {
  it.each(Object.keys(PacketId) as PacketName[])('%s: encode is exactly PACKET_SIZES long and decode inverts it', (name) => {
    fc.assert(fc.property(arbitraryPacket(name), (packet) => {
      const bytes = encode(packet);
      expect(bytes.length).toBe(PACKET_SIZES[name]);
      expect(decode(bytes)).toEqual({ ok: true, packet });
    }), { numRuns: 40 });
  });
  it('decodes a view with a non-zero byteOffset (records are views into a chunk)', () => {
    const [packet] = fc.sample(arbitraryPacket('carTelemetry'), { numRuns: 1, seed: 7 });
    const bytes = encode(packet!);
    const padded = new Uint8Array(bytes.length + 7);
    padded.set(bytes, 7);
    expect(decode(padded.subarray(7))).toEqual({ ok: true, packet });
  });
});

describe('peekHeader', () => {
  it('is undefined below 29 bytes', () => expect(peekHeader(new Uint8Array(28))).toBeUndefined());
  it('reads the header without validating format, id or size', () => {
    const bytes = raw(16, 29, 2024);
    new DataView(bytes.buffer).setBigUint64(7, 0xb3cd07e2790bdcben, true);
    expect(peekHeader(bytes)).toMatchObject({ packetFormat: 2024, packetId: 16, sessionUid: 12956020372289608894n });
  });
});
