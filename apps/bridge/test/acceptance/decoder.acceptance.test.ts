// The decoder on whole recordings: same packets as the reference decoder, and fast enough for replay-heavy tests.
import { isDeepStrictEqual } from 'node:util';
import { expect, it } from 'vitest';
import { decode } from '@pitwall/protocol';
import { FIXTURES, describeWithFixture, type FixtureName } from '../../../../test-support/fixtures.ts';
import { referenceDecode } from '../../../../test-support/reference-decoder.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';

/** The big races are too big to decode twice here, and the time trial is no test fixture (user ruling 2026-10-30); the segments and the other recordings cover the same packet layouts. */
const EXCLUDED: readonly FixtureName[] = ['raceSingaporeWet', 'raceZandvoortUidReuse', 'raceWetVscMexico', 'ttZandvoort'];

/** Best of three warm passes over every `qualifyingSingapore` payload; the generic interpreter took about 4 400 ms. */
const SPEED_TARGET_MS = 1_500;
const TIMED_PASSES = 3;

for (const name of Object.keys(FIXTURES) as FixtureName[]) {
  if (EXCLUDED.includes(name)) continue;
  describeWithFixture(name, `decoder: ${name}`, (path) => {
    it('every record decodes exactly as the reference decoder', async () => {
      let index = 0;
      for await (const record of readPwrec(path)) {
        if (!isDeepStrictEqual(decode(record.payload), referenceDecode(record.payload))) {
          throw new Error(`${name}: record ${index} (packet id ${record.payload[6]}) differs from the reference decoder`);
        }
        index++;
      }
      expect(index).toBeGreaterThan(0);
    });
  });
}

describeWithFixture('qualifyingSingapore', 'decoder speed: qualifyingSingapore', (path) => {
  it(`the best of ${TIMED_PASSES} warm passes takes at most ${SPEED_TARGET_MS} ms`, async () => {
    const payloads: Uint8Array[] = [];
    for await (const record of readPwrec(path)) payloads.push(record.payload);
    const pass = (): number => {
      let ok = 0;
      for (const payload of payloads) if (decode(payload).ok) ok++;
      return ok;
    };
    const warm = pass(); // the counts keep the results observable
    expect(warm).toBeGreaterThan(0);
    const times: number[] = [];
    for (let i = 0; i < TIMED_PASSES; i++) {
      const start = performance.now();
      const ok = pass();
      times.push(performance.now() - start);
      expect(ok).toBe(warm);
    }
    const best = Math.min(...times);
    console.info(`[decoder speed] qualifyingSingapore, ${payloads.length} datagrams: ${times.map((t) => t.toFixed(0)).join(' ms, ')} ms (best ${best.toFixed(0)} ms, target ${SPEED_TARGET_MS} ms)`);
    expect(best).toBeLessThanOrEqual(SPEED_TARGET_MS);
  });
});
