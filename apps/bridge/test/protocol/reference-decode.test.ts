// Characterization guard for the decoder: `decode` returns exactly what the generic interpreter returned.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { EVENT_CODES, PACKET_SIZES, PacketId, decode, type DecodeResult } from '@pitwall/protocol';
import { referenceDecode } from '../../../../test-support/reference-decoder.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';

const SEGMENTS = join(import.meta.dirname, '../../../../fixtures/segments');
// The full-lap segments (about 8 MB) hold the same packet kinds as the short ones; decoding each of their records
// twice takes longer than a unit test may, so they are left out here.
const segmentFiles = readdirSync(SEGMENTS)
  .filter((file) => file.endsWith('.pwrec.gz') && !file.endsWith('-full-lap.pwrec.gz'))
  .sort();

/** Key order matters too: downstream hashes serialise packets. `bigint` becomes a tagged string. */
const serialise = (result: DecodeResult): string =>
  JSON.stringify(result, (_key, value: unknown) => (typeof value === 'bigint' ? `${value}n` : value));

/** `undefined` when both decoders agree; otherwise what differs, for the failure message. */
function mismatch(bytes: Uint8Array): string | undefined {
  const actual = decode(bytes);
  const expected = referenceDecode(bytes);
  if (!isDeepStrictEqual(actual, expected)) return 'values differ';
  if (serialise(actual) !== serialise(expected)) return 'key order differs';
  return undefined;
}

const packetIdOf = (bytes: Uint8Array): number | undefined => bytes[6];

function raw(packetId: number, length: number, format = 2025): Uint8Array {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  if (length >= 2) view.setUint16(0, format, true);
  if (length >= 7) view.setUint8(6, packetId);
  return bytes;
}

/** Deterministic pseudo-random bytes (a 32-bit LCG), so every field sees non-zero, negative and NaN values. */
function noise(bytes: Uint8Array, seed: number, from: number): Uint8Array {
  let state = seed >>> 0;
  for (let i = from; i < bytes.length; i++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[i] = state >>> 24;
  }
  return bytes;
}

const HEADER_TAIL = 7; // packetFormat (2) .. packetId (1): the rest of the header may be noise

describe('decode matches the reference decoder', () => {
  it.each(segmentFiles)('every record of fixtures/segments/%s', async (file) => {
    let index = 0;
    let decoded = 0;
    for await (const record of readPwrec(join(SEGMENTS, file))) {
      const differs = mismatch(record.payload);
      if (differs !== undefined) {
        throw new Error(`${file}: record ${index} (packet id ${packetIdOf(record.payload)}): ${differs}`);
      }
      if (decode(record.payload).ok) decoded++;
      index++;
    }
    expect(index).toBeGreaterThan(0);
    expect(decoded).toBe(index);
  });

  it('every packet id on pseudo-random bytes', () => {
    for (const [name, id] of Object.entries(PacketId)) {
      for (let seed = 1; seed <= 20; seed++) {
        const bytes = noise(raw(id, PACKET_SIZES[name as keyof typeof PACKET_SIZES]), seed * 7919 + id, HEADER_TAIL);
        if (name === 'event') bytes.set([...EVENT_CODES[seed % EVENT_CODES.length]!].map((c) => c.charCodeAt(0)), 29);
        expect(mismatch(bytes), `${name}, seed ${seed}`).toBeUndefined();
      }
    }
  });

  it('every event code', () => {
    for (const [i, code] of EVENT_CODES.entries()) {
      const bytes = noise(raw(PacketId.event, PACKET_SIZES.event), i + 1, HEADER_TAIL);
      bytes.set([...code].map((c) => c.charCodeAt(0)), 29);
      const result = decode(bytes);
      expect(result.ok && result.packet.packetId === PacketId.event && result.packet.details.code, code).toBe(code);
      expect(mismatch(bytes), code).toBeUndefined();
    }
  });

  it('errors: truncated header, truncated body, unknown packet id, wrong format, unknown event code', () => {
    const unknownEvent = raw(PacketId.event, PACKET_SIZES.event);
    unknownEvent.set([65, 66, 67, 68], 29);
    const cases: Record<string, Uint8Array> = {
      'empty': new Uint8Array(0),
      'truncated header': raw(PacketId.lapData, 28),
      'truncated body': raw(PacketId.carTelemetry, PACKET_SIZES.carTelemetry - 1),
      'too long': raw(PacketId.event, PACKET_SIZES.event + 1),
      'unknown packet id': raw(16, 100),
      'wrong format': raw(PacketId.lapData, PACKET_SIZES.lapData, 2024),
      'unknown event code': unknownEvent,
    };
    for (const [label, bytes] of Object.entries(cases)) {
      expect(decode(bytes).ok, label).toBe(false);
      expect(mismatch(bytes), label).toBeUndefined();
    }
  });
});
