// The decoder's speed budget on a segment (R20, contract C5): every payload of the full-lap segment
// race-zandvoort-full-lap (fixtures/index.json: 28 108 packets of a 20-car race lap) decodes in under 0.015 ms per packet
// on average. The profile measured 0.030 ms per packet. The payloads are read once; each pass decodes all of them. The
// best of the timed passes counts, so machine load (a parallel suite, a busy core) cannot flake it (docs/testing.md 6).
import { describe, expect, it } from 'vitest';
import { readPwrec } from '../../../apps/bridge/src/pwrec/reader.ts';
import { segmentPath } from '../../../test-support/segments.ts';
import { decode } from '../src/index.ts';

const FULL_LAP = 'race-zandvoort-full-lap.pwrec.gz';
/** Timed passes after one warm pass; the best of them counts. */
const PASSES = 5;
const TARGET_MS_PER_PACKET = 0.015;

describe('decoder budget', () => {
  it(`race-zandvoort-full-lap: the best of ${PASSES} warm passes decodes a packet in under ${TARGET_MS_PER_PACKET} ms on average`, async () => {
    const payloads: Uint8Array[] = [];
    for await (const record of readPwrec(segmentPath(FULL_LAP))) payloads.push(record.payload);
    expect(payloads.length).toBeGreaterThan(25_000);

    /** One pass: every payload decoded; the count of decoded packets keeps the work observable. */
    const pass = (): number => {
      let ok = 0;
      for (const payload of payloads) if (decode(payload).ok) ok++;
      return ok;
    };
    const warm = pass();
    expect(warm).toBeGreaterThan(0);
    const times: number[] = [];
    for (let i = 0; i < PASSES; i++) {
      const start = performance.now();
      const ok = pass();
      times.push(performance.now() - start);
      expect(ok).toBe(warm);
    }
    const best = Math.min(...times);
    const perPacket = best / payloads.length;
    console.info(`[decoder budget] ${FULL_LAP}, ${payloads.length} packets: ${times.map((t) => t.toFixed(0)).join(' ms, ')} ms (best ${perPacket.toFixed(4)} ms per packet, target ${TARGET_MS_PER_PACKET} ms)`);
    expect(perPacket).toBeLessThan(TARGET_MS_PER_PACKET);
  });
});
