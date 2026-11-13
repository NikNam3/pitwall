// `pit-sweep`'s budget (SP4.3b spec §9.2, §11.2; plan 4.3b2 Task 18q row 5, replacing Task 8c row 4; Q10 A + B: one
// part per car and compound, 10 s per thread; Global Constraints "caps are counts"): on the long-race builder (70 laps,
// 20 cars) at lap 1 (the first frame the starting point is known: the leader has completed lap 1), the player's medium
// part (`PIT_SWEEP_JOB.parts.split`) at the config's `maxScenarioPolicies`, its one DP solve included, under 10 s: each
// part runs on its own thread. Its window is six stop laps wide, so its rows run 17 stop laps (`rowsBefore` 3 +
// window 6 + `rowsAfter` 8; about 500 races per row at the cap). The cap is a count (C2): a miss lowers the count,
// never raises the budget. Best of warm passes (docs/testing.md).
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { PIT_SWEEP_CONFIG, PIT_SWEEP_JOB } from '../../src/pit-sweep/index.ts';
import { run } from '../../src/pit-sweep/job.ts';
import { PLAYER, sweepViewAt } from './support.ts';

/** The config's `maxScenarioPolicies` (per car and compound) this budget is measured at; sized by the supervisor from an idle measurement (Q10: ≈ 500 races per row at 17 rows). */
const CAP = 7_000;
const PART_MS = 10_000;
const COMPOUND = 'medium';

describe('pit-sweep budget', () => {
  // Task 18q row 5
  it('budget: one (car, compound) part at the config\'s cap under 10 s at lap 1 of the long race', () => {
    const cap = PIT_SWEEP_CONFIG.defaults.maxScenarioPolicies;
    expect(cap).toBe(CAP);
    // the window L(now + 10)–L(now + 15): rows L(now + 7)–L(now + 23)
    const view = sweepViewAt(longRace(), 2, {
      frameOfLap: 0,
      window: { compounds: ['soft', 'medium', 'hard'], latestIn: 15, earliestIn: 10 },
      sweepConfig: { maxScenarioPolicies: cap },
    });
    const parts = PIT_SWEEP_JOB.parts;
    if (parts === undefined) throw new Error('PIT_SWEEP_JOB declares no parts (Task 18q: one part per our car and compound)');
    const input = PIT_SWEEP_JOB.prepare(view);
    const all = parts.split(input);
    expect(all.length, 'one part per car and compound').toBe(6);
    const part = all.find((p) => Object.keys(p.cars).map(Number).includes(PLAYER) && p.cars[PLAYER]!.compounds.includes(COMPOUND));
    expect(part, 'the player\'s medium part').toBeDefined();
    expect(part!.cars[PLAYER]!.compounds, 'the part holds only medium').toEqual([COMPOUND]);
    let best = Infinity;
    let out: ReturnType<typeof run> | undefined;
    for (let k = 0; k < 3; k++) {
      const copy = structuredClone(part!);
      const t0 = performance.now();
      out = run(copy, createRng(7));
      // the first pass warms
      if (k > 0) best = Math.min(best, performance.now() - t0);
    }
    const table = out?.[PLAYER]?.byCompound[COMPOUND];
    expect(table?.known, `the ${COMPOUND} table`).toBe(true);
    const rows = table!.known ? table!.value.rows.length : 0;
    expect(rows, COMPOUND).toBeGreaterThanOrEqual(15);
    expect(rows, COMPOUND).toBeLessThanOrEqual(17);
    console.info(`[pit-sweep budget] car ${PLAYER}'s ${COMPOUND} part, ${rows} rows at cap ${cap} (${table!.known ? table!.value.scenarios : 0} races per row): ${best.toFixed(0)} ms (long race, lap 1)`);
    expect(best).toBeLessThan(PART_MS);
  }, 180_000);
});
