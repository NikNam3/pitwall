// `pit-sweep`'s budget (SP4.3b spec §9.2, §11.2; plan 4.3b2 Task 8c row 4, replacing Task 8 row 11; Q9 A; Global
// Constraints "caps are counts"): on the long-race builder (70 laps, 20 cars) at lap 1 (the first frame the starting
// point is known: the leader has completed lap 1), one car's part (`PIT_SWEEP_JOB.parts.split`, our two cars) over
// three compounds (soft, medium, hard) at the config's `maxScenarioPolicies` per compound, its one DP solve included,
// under 5 s: each part runs on its own thread. The cap is a count (C2): a miss lowers the count, never raises the
// budget. Best of warm passes (docs/testing.md).
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { PIT_SWEEP_CONFIG, PIT_SWEEP_JOB } from '../../src/pit-sweep/index.ts';
import { run } from '../../src/pit-sweep/job.ts';
import { PLAYER, sweepViewAt } from './support.ts';

/** The config's `maxScenarioPolicies` (per car and compound) this budget is measured at; set by the supervisor. */
const CAP = 1_000;
const PART_MS = 5_000;
const COMPOUNDS = ['soft', 'medium', 'hard'] as const;

describe('pit-sweep budget', () => {
  // row 4
  it('budget: one car\'s part over three compounds (soft, medium, hard) at the config\'s maxScenarioPolicies under 5 s at lap 1 of the long race, its DP solve included', () => {
    const cap = PIT_SWEEP_CONFIG.defaults.maxScenarioPolicies;
    expect(cap).toBe(CAP);
    const view = sweepViewAt(longRace(), 2, {
      frameOfLap: 0,
      window: { compounds: [...COMPOUNDS], latestIn: null },
      sweepConfig: { maxScenarioPolicies: cap },
    });
    const parts = PIT_SWEEP_JOB.parts;
    if (parts === undefined) throw new Error('PIT_SWEEP_JOB declares no parts (Task 8c: one part per our car)');
    const input = PIT_SWEEP_JOB.prepare(view);
    const part = parts.split(input).find((p) => Object.keys(p.cars).map(Number).includes(PLAYER));
    expect(part, 'the player\'s part').toBeDefined();
    expect(Object.keys(part!.cars).map(Number), 'the part holds only the player').toEqual([PLAYER]);
    let best = Infinity;
    let out: ReturnType<typeof run> | undefined;
    for (let k = 0; k < 4; k++) {
      const copy = structuredClone(part!);
      const t0 = performance.now();
      out = run(copy, createRng(7));
      // the first pass warms
      if (k > 0) best = Math.min(best, performance.now() - t0);
    }
    const counts: string[] = [];
    for (const compound of COMPOUNDS) {
      const table = out?.[PLAYER]?.byCompound[compound];
      expect(table?.known, `the ${compound} table`).toBe(true);
      const rows = table!.known ? table!.value.rows.length : 0;
      expect(rows, compound).toBeGreaterThan(10);
      counts.push(`${compound} ${rows}`);
    }
    console.info(`[pit-sweep budget] car ${PLAYER}'s part, rows ${counts.join(', ')} at cap ${cap} per compound: ${best.toFixed(0)} ms (long race, lap 1)`);
    expect(best).toBeLessThan(PART_MS);
  }, 180_000);
});
