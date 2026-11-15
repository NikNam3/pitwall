// `drawNeutralisations` under a neutralisation out now (SP4.3c Task 4, spec §5.3 O6; C43): when a new one may start is
// `race-hazard`'s `allowed`, already folded into its `byLap` chances; the simulator blocks no lap of its own after the
// active one. So the share of scenarios with a new start on a lap is that lap's chance, also on the lap right after the
// active one ends. 10,000 scenarios under one base seed (C2); the share within 2 points of the chance (about 4 σ).
import { describe, expect, it } from 'vitest';
import { drawNeutralisations, scenarioDraws } from '../../src/race-monte-carlo/scenarios.ts';
import { startingPoint } from '../race-forecast/start.ts';
import { hazard } from './support.ts';

const N = 10_000;
const BASE = 4_242;

describe('drawNeutralisations: new starts under an active SC follow race-hazard only', () => {
  // the leader on lap 5 of 20; an SC out now that ends this lap (laps left: 0 with certainty)
  const start = startingPoint({ lapsTotal: 20, lap: 5, cars: [{}, {}], ours: [0] });
  const active = { condition: 'sc' as const, remaining: Float64Array.from([1]) };

  /** The share of the scenarios with a new start (not the active one) on lap `lap`, and of each kind. */
  const shareOn = (hz: ReturnType<typeof hazard>, lap: number): { sc: number; vsc: number } => {
    let sc = 0;
    let vsc = 0;
    for (let id = 1; id <= N; id++) {
      const list = drawNeutralisations(start, hz, scenarioDraws(start, BASE, id));
      const [first, ...rest] = list;
      // the active one comes first, from the current lap
      expect(first).toMatchObject({ kind: 'sc', fromLap: 5, toLap: 5 });
      for (const n of rest) {
        if (n.fromLap !== lap) continue;
        if (n.kind === 'sc') sc++;
        else vsc++;
      }
    }
    return { sc: sc / N, vsc: vsc / N };
  };

  it("the lap right after the active one ends: its SC chance, as race-hazard gives it (no second block)", () => {
    // race-hazard's byLap index 1 is lap 6; it gives 0.3 there
    const share = shareOn(hazard(16, { sc: { 1: 0.3 }, active }), 6);
    expect(Math.abs(share.sc - 0.3)).toBeLessThanOrEqual(0.02);
    expect(share.vsc).toBe(0);
  });

  it('and its VSC chance likewise', () => {
    const share = shareOn(hazard(16, { vsc: { 1: 0.25 }, active }), 6);
    expect(Math.abs(share.vsc - 0.25)).toBeLessThanOrEqual(0.02);
    expect(share.sc).toBe(0);
  });

  it('a lap race-hazard gives 0 has no start', () => {
    expect(shareOn(hazard(16, { sc: { 3: 0.3 }, active }), 6)).toEqual({ sc: 0, vsc: 0 });
  });
});
