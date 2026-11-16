// `gaps` from scratch on the long race (`test-support/builders`, 70 laps, 20 cars) gives the answers it gave before
// SP4.3c Task 25w (ruling R66: the crossing times in dense typed arrays, no read-back after a folded crossing; same
// answers). The other gaps tests check the answers on small races; this one pins the whole output of `init` + `output`
// at the end of an early lap, the safety-car lap and the last lap, as a digest of its JSON, taken from the code before
// Task 25w.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';

/** The sha-256 of the JSON of `init` + `output` at the last frame of each lap, before Task 25w. */
const BEFORE: Record<number, string> = {
  7: '617512f2b01224f34a7a7f9d1ac20a2e2ea224dd57870e839f957add2107e552',
  31: '85cad290ee16807666ee487916541769bfa436154acfee9dfe989ad0594a8ed2',
  70: 'd6a26c2235a5846520bab90b5d1e077ee595f965f03e17d19b6ecc1253bbc5e2',
};

const digestAt = (lap: number): string => {
  const race = longRace();
  const view = race.viewAt(race.framesOfLap(lap).at(-1)!);
  return createHash('sha256').update(JSON.stringify(gapsCalculator.output(gapsCalculator.init(view), view))).digest('hex');
};

describe('gaps from scratch on the long race: the answers before Task 25w', () => {
  for (const lap of Object.keys(BEFORE).map(Number)) {
    it(`init + output at the end of lap ${lap} equals the output before Task 25w`, () => {
      expect(digestAt(lap)).toBe(BEFORE[lap]);
    });
  }
});
