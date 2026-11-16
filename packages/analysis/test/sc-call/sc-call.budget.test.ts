// `sc-call`'s budget (SP4.3d spec §6.3: ≤ 5 s per car on its own thread, 3 conditions × up to 6 rows, the cap set from
// a measurement; plan SP4.3d1 Task 6 row 6; Global Constraints "caps are counts, never clocks"): on the long-race
// builder (70 laps, 20 cars) at lap 1 (the first frame the starting point is known: the leader has completed lap 1),
// the player's part (`SC_CALL_JOB.parts.split`, one part per our car, as `pit-sweep`'s and `strategy`'s parts) at the
// config's `maxScenarioPolicies`, its one DP solve included, under 5 s: each part runs on its own thread. The cap is a
// count (C2): a miss lowers the count, never raises the budget; its doc comment names the measurement it comes from.
// Best of warm passes (docs/testing.md). `rejoin`'s output is passed explicitly (`./support.ts`).
import { readFileSync } from 'node:fs';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { SC_CALL_CONFIG, SC_CALL_JOB } from '../../src/sc-call/index.ts';
import { run } from '../../src/sc-call/job.ts';
import { blockOf, callOf, optionOf, PLAYER, scViewAt } from './support.ts';
import { LONG_RACE_OURS_SETS } from '../strategy/support.ts';

const PART_MS = 5_000;

describe('sc-call budget', () => {
  // Task 6 row 6
  it('budget: one car part at the config\'s cap under 5 s at lap 1 of the long race, three blocks of six options, one DP solve included', () => {
    const cap = SC_CALL_CONFIG.defaults.maxScenarioPolicies;
    expect(Number.isInteger(cap) && cap > 0, 'the cap is a count').toBe(true);
    const view = scViewAt(longRace(), 2, { frameOfLap: 0, sets: LONG_RACE_OURS_SETS, scConfig: { maxScenarioPolicies: cap } });
    const parts = SC_CALL_JOB.parts;
    if (parts === undefined) throw new Error('SC_CALL_JOB declares no parts (Task 6: one part per our car)');
    const all = parts.split(SC_CALL_JOB.prepare(view));
    expect(all.length, 'one part per our car').toBe(2);
    const part = all.find((p) => Object.keys(p.cars).map(Number).includes(PLAYER));
    expect(part, "the player's part").toBeDefined();
    expect(Object.keys(part!.cars).map(Number), 'the part holds only the player').toEqual([PLAYER]);

    let best = Infinity;
    let out: ReturnType<typeof run> | undefined;
    for (let k = 0; k < 3; k++) {
      const copy = structuredClone(part!);
      const t0 = performance.now();
      out = run(copy, createRng(7));
      // the first pass warms
      if (k > 0) best = Math.min(best, performance.now() - t0);
    }
    const call = callOf(out!, PLAYER);
    expect(call.blocks.map((b) => b.condition)).toEqual(['sc', 'vsc', 'green']);
    // the long race's sets: the fitted medium, a new soft, medium and hard; no inter or wet set
    for (const condition of ['sc', 'vsc', 'green'] as const) {
      const block = blockOf(call, condition);
      for (const answer of ['stay', 'S', 'M', 'H'] as const) expect(optionOf(block, answer).ePos.known, `${condition} ${answer}`).toBe(true);
    }
    console.info(`[sc-call budget] car ${PLAYER}'s part at cap ${cap}: ${best.toFixed(0)} ms (long race, lap 1, one DP solve)`);
    expect(best).toBeLessThan(PART_MS);
  }, 180_000);

  // Task 6 row 6: the cap's source is the measurement
  it("the cap's doc comment in config.ts names its SP4.3d1 measurement", () => {
    const source = readFileSync(new URL('../../src/sc-call/config.ts', import.meta.url), 'utf8');
    const doc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*maxScenarioPolicies:/.exec(source)?.[1] ?? '';
    expect(doc, 'the doc comment of maxScenarioPolicies').toMatch(/SP4\.3d1/);
    expect(doc, 'the doc comment of maxScenarioPolicies').toMatch(/measured/i);
    expect(doc, 'the doc comment names the budget').toMatch(/5 s/);
  });
});
