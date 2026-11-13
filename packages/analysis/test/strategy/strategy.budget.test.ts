// `strategy`'s budget (SP4.3b spec §8.1, §11.2, S26; plan 4.3b1 Task 20 row 12): on the long-race builder (70 laps,
// 20 cars) at lap 1 (the first frame the starting point is known: the leader has completed lap 1), `prepare` under
// 20 ms and the job, both our cars at the config's `maxScenarioPolicies`, within 5 s single thread. The cap is a count
// (C2): a miss lowers the count, never raises the budget. Best of warm passes (docs/testing.md).
//
// Good selection (spec §7.4; plan 4.3b1 Task 20b): the stored candidates of the test race through the capped search
// at the config's `maxScenarioPolicies` give, per our car, a winner whose reference E[position] lies within 0.05
// places of the reference's winner. The reference (`test-support/fixtures/strategy-reference.json`, 50,000 scenarios
// per candidate) is never computed here: `pnpm gen:strategy-reference` makes it (supervisor, tens of minutes).
//
// How this row reads the script (the test agent's decisions, Task 20b report): `scripts/gen-strategy-reference.ts`
// exports `REFERENCE_FILE` (the fixture's absolute path), the fixture's type `StrategyReference` (`sourceHash`,
// `generatorParams`, per our car `candidates: McCandidate[]`, `ePos: number[]` in the candidates' order and `winner`,
// the index of the least E[position]), `strategyReferenceHash()` and `strategyReferenceInput()`: the test race's
// `race-monte-carlo` input as the script scores it (both our cars' candidates from `strategy`'s `candidatesOf`, the
// config's search settings); importing it runs nothing.
import { existsSync, readFileSync } from 'node:fs';
import type { CarId } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { REFERENCE_FILE, strategyReferenceHash, strategyReferenceInput, type StrategyReference } from '../../../../scripts/gen-strategy-reference.ts';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { raceMonteCarlo } from '../../src/race-monte-carlo/index.ts';
import { prepareStrategy, runStrategy, STRATEGY_CONFIG } from '../../src/strategy/index.ts';
import { OURS, viewAt } from './support.ts';

const GOOD_SELECTION_PLACES = 0.05;

/** The stored reference; a missing or stale one fails with "regenerate the reference". */
function reference(): StrategyReference {
  const regenerate = 'regenerate the reference (pnpm gen:strategy-reference, supervisor)';
  if (!existsSync(REFERENCE_FILE)) throw new Error(`${regenerate}: ${REFERENCE_FILE} is missing`);
  const ref = JSON.parse(readFileSync(REFERENCE_FILE, 'utf8')) as StrategyReference;
  const hash = strategyReferenceHash();
  if (ref.sourceHash !== hash) throw new Error(`${regenerate}: its sourceHash ${ref.sourceHash} differs from the sources' ${hash}`);
  return ref;
}

const PREPARE_MS = 20;
const JOB_MS = 5_000;

describe('strategy budget', () => {
  // row 12
  it('budget: prepare under 20 ms; the job with maxScenarioPolicies 6,000 finishes within 5 s single thread at lap 1 of the long race', () => {
    const cap = STRATEGY_CONFIG.defaults.maxScenarioPolicies;
    const view = viewAt(longRace(), 2, { frameOfLap: 0, config: { maxScenarioPolicies: cap } });

    let prepareBest = Infinity;
    for (let k = 0; k < 3; k++) prepareStrategy(view);
    for (let k = 0; k < 10; k++) {
      const t0 = performance.now();
      prepareStrategy(view);
      prepareBest = Math.min(prepareBest, performance.now() - t0);
    }

    const input = structuredClone(prepareStrategy(view));
    expect(input.start.known).toBe(true);
    let jobBest = Infinity;
    let out: ReturnType<typeof runStrategy> | undefined;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      out = runStrategy(structuredClone(input), createRng(7));
      // the first pass warms
      if (k > 0) jobBest = Math.min(jobBest, performance.now() - t0);
    }
    for (const car of OURS) expect(out?.[car]?.known, `car ${car}`).toBe(true);
    console.info(`[strategy budget] prepare ${prepareBest.toFixed(1)} ms, job ${jobBest.toFixed(0)} ms at cap ${cap} (long race, lap 1)`);
    expect(prepareBest).toBeLessThan(PREPARE_MS);
    expect(jobBest).toBeLessThan(JOB_MS);
  }, 60_000);

  // Task 20b
  it('good selection: the stored candidates through the capped search (maxScenarioPolicies from config) give a winner within 0.05 places of the reference\'s; a reference whose sourceHash differs fails with "regenerate the reference"', () => {
    const ref = reference();
    const cap = STRATEGY_CONFIG.defaults.maxScenarioPolicies;
    const built = strategyReferenceInput();
    // the stored candidates are the builder's (the hash matched)
    expect(JSON.stringify(built.candidates)).toBe(JSON.stringify(ref.candidates));
    const input = { ...built, candidates: ref.candidates, config: { ...built.config, maxScenarioPolicies: cap } };
    const out = raceMonteCarlo(input, createRng(2_020), cap);

    const cars = Object.keys(ref.candidates).map(Number) as CarId[];
    expect(cars.length).toBeGreaterThan(0);
    for (const car of cars) {
      const candidates = ref.candidates[car]!;
      const ePos = ref.ePos[car]!;
      expect(ePos.length, `car ${car}`).toBe(candidates.length);
      const best = ePos[ref.winner[car]!]!;
      expect(best, `car ${car}: the reference's winner has the least E[position]`).toBe(Math.min(...ePos));
      const winner = out[car]?.rows[0];
      expect(winner, `car ${car}`).toBeDefined();
      const k = candidates.findIndex((c) => JSON.stringify(c.policy) === JSON.stringify(winner!.policy));
      expect(k, `car ${car}: the capped winner is a stored candidate`).toBeGreaterThanOrEqual(0);
      console.info(`[strategy good selection] car ${car}: capped winner #${k} ref E[pos] ${ePos[k]!.toFixed(3)}, reference winner #${ref.winner[car]} ${best.toFixed(3)}, ${candidates.length} candidates, cap ${cap}`);
      expect(ePos[k]! - best, `car ${car}`).toBeLessThanOrEqual(GOOD_SELECTION_PLACES);
    }
  }, 120_000);
});
