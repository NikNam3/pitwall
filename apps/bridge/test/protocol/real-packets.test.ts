// Real datagrams from the committed segments and the two tiny recordings: each decodes and re-encodes byte-identically.
import { describe, expect, it } from 'vitest';
import { decode, encode } from '@pitwall/protocol';
import { describeWithFixture, type FixtureName } from '../../../../test-support/fixtures.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { SEGMENT_FILES, segmentPath } from '../fixtures/replay.ts';

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The datagrams that do not decode, or that decode and do not re-encode to the same bytes. */
async function roundTripFailures(path: string): Promise<{ total: number; failed: string[] }> {
  let total = 0;
  const failed: string[] = [];
  for await (const record of readPwrec(path)) {
    total++;
    const r = decode(record.payload);
    if (!r.ok) failed.push(`datagram ${total}: ${JSON.stringify(r.error)}`);
    else {
      try {
        if (!equalBytes(encode(r.packet), record.payload)) failed.push(`datagram ${total}: packet ${r.packet.packetId} re-encodes differently`);
      } catch (error) {
        failed.push(`datagram ${total}: packet ${r.packet.packetId} does not re-encode: ${String(error)}`);
      }
    }
  }
  return { total, failed };
}

describe('real packets: committed segments', () => {
  it.each(SEGMENT_FILES)('%s: every datagram decodes and re-encodes byte-identically', async (file) => {
    const { total, failed } = await roundTripFailures(segmentPath(file));
    expect(total).toBeGreaterThan(0);
    expect(failed).toEqual([]);
  });
});

for (const name of ['menuOnly', 'lobbyOnly'] as const satisfies FixtureName[]) {
  describeWithFixture(name, `real packets: ${name}`, (path) => {
    it('every datagram decodes and re-encodes byte-identically', async () => {
      const { total, failed } = await roundTripFailures(path);
      expect(total).toBeGreaterThan(0);
      expect(failed).toEqual([]);
    });
  });
}
