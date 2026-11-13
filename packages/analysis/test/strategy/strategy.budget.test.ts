// `strategy`'s budget (SP4.3b spec §8.1, §11.2, S26; plan 4.3b1 Task 20 row 12, ported in Task 25): on the long-race
// builder (70 laps, 20 cars) at lap 1 (the first frame the starting point is known: the leader has completed lap 1),
// `prepare` under 20 ms and one car's part (SP4.3b Q4 D: one part per our car, each at the config's
// `maxScenarioPolicies`, one worker each) within 7 s single thread (Task 28, Q7 A: zDrop 3.2, cap 8,000). The cap is a
// count (C2): a miss lowers the count, never raises the budget. Best of warm passes (docs/testing.md).
//
// Good selection (spec §7.4; plan 4.3b1 Task 20b, ported in Task 25; judged over seeds since Task 28, Q7 A): each car's
// final call as the reference holds it (`strategyReferenceInputs()`: the part's final-call input, the teammate fixed by
// round 1 under the reference's seed), run by `raceMonteCarlo` at the call's cap with seeds 1–8; per car the mean
// regret (the pick's reference E[position] less the reference winner's) at most 0.05 places and the worst at most 0.2.
// The reference (`test-support/fixtures/strategy-reference.json`, 50,000 scenarios per candidate) is never computed
// here: `pnpm gen:strategy-reference` makes it (supervisor, tens of minutes).
//
// How this row reads the script (the test agent's decisions, Task 20b, 25 and 28 reports):
// `scripts/gen-strategy-reference.ts` exports `REFERENCE_FILE` (the fixture's absolute path), the fixture's type
// `StrategyReference` (`sourceHash`, `generatorParams`, per our car `candidates: McCandidate[]`, `ePos: number[]` in the
// candidates' order and `winner`, the index of the least E[position]), `strategyReferenceHash()` and
// `strategyReferenceInputs()` (one final call per our car, its cap in `mc.config.maxScenarioPolicies`); importing it
// runs nothing.
import { existsSync, readFileSync } from 'node:fs';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { REFERENCE_FILE, strategyReferenceHash, strategyReferenceInputs, type StrategyReference } from '../../../../scripts/gen-strategy-reference.ts';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { raceMonteCarlo } from '../../src/race-monte-carlo/index.ts';
import { prepareStrategy, runStrategy, STRATEGY_CONFIG } from '../../src/strategy/index.ts';
import { jobParts, OURS, viewAt } from './support.ts';

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
/** One car's part (user, Q7: up to 10 s per part per core accepted; Task 28: 7 s). */
const JOB_MS = 7_000;

/** Task 28 (Q7 A, the diagnosis table): the search's drop threshold and the cap the 7 s part runs at. */
const Q7_Z_DROP = 3.2;
const Q7_CAP = 8_000;

/** Good selection over seeds (Task 28): per car, mean regret and worst regret (reference E[position] places). */
const GOOD_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const MEAN_REGRET = 0.05;
const WORST_REGRET = 0.2;

describe('strategy budget', () => {
  // row 12, ported in Task 25 and Task 28 (the part's row is Task 28 row 5)
  it('budget: prepare under 20 ms at lap 1 of the long race', () => {
    const view = viewAt(longRace(), 2, { frameOfLap: 0, config: { maxScenarioPolicies: STRATEGY_CONFIG.defaults.maxScenarioPolicies } });
    let prepareBest = Infinity;
    for (let k = 0; k < 3; k++) prepareStrategy(view);
    for (let k = 0; k < 10; k++) {
      const t0 = performance.now();
      prepareStrategy(view);
      prepareBest = Math.min(prepareBest, performance.now() - t0);
    }
    console.info(`[strategy budget] prepare ${prepareBest.toFixed(1)} ms (long race, lap 1)`);
    expect(prepareBest).toBeLessThan(PREPARE_MS);
  }, 60_000);

  // Task 28 row 5 (replaces the 5 s row): each car's part at the config's cap, zDrop and cap as Q7 A sets them
  it('budget: one car\'s part at lap 1 on the long-race builder within 7 s', () => {
    expect(STRATEGY_CONFIG.defaults.zDrop, 'zDrop (Q7 A)').toBe(Q7_Z_DROP);
    expect(STRATEGY_CONFIG.defaults.maxScenarioPolicies, 'maxScenarioPolicies (Q7 A)').toBe(Q7_CAP);
    const cap = STRATEGY_CONFIG.defaults.maxScenarioPolicies;
    const view = viewAt(longRace(), 2, { frameOfLap: 0, config: { maxScenarioPolicies: cap } });
    const input = structuredClone(prepareStrategy(view));
    expect(input.start.known).toBe(true);
    const parts = jobParts().split(input);
    expect(parts.map((p) => p.planCar), 'one part per our car').toEqual([...OURS]);
    for (const part of parts) {
      const car = part.planCar!;
      let partBest = Infinity;
      let out: ReturnType<typeof runStrategy> | undefined;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        out = runStrategy(structuredClone(part), createRng(7));
        // the first pass warms
        if (k > 0) partBest = Math.min(partBest, performance.now() - t0);
      }
      expect(out?.[car]?.known, `car ${car}`).toBe(true);
      console.info(`[strategy budget] car ${car}'s part ${partBest.toFixed(0)} ms at cap ${cap} (long race, lap 1)`);
      expect(partBest, `car ${car}'s part`).toBeLessThan(JOB_MS);
    }
  }, 180_000);

  // Task 28 row 4 (replaces Task 20b's one-seed row, ported in Task 25): each car's final call, the teammate fixed as
  // the reference holds it, run with seeds 1–8 at the call's cap; regret is the reference E[position] of the pick less
  // the reference winner's
  it('good selection: over seeds 1–8 on the reference\'s final-call input, mean regret ≤ 0.05 and worst ≤ 0.2 per car', () => {
    const ref = reference();
    const calls = strategyReferenceInputs();
    expect(calls.map((c) => c.car).sort((a, b) => a - b), 'one final call per our car').toEqual([...OURS].sort((a, b) => a - b));
    for (const { car, mc } of calls) {
      const candidates = ref.candidates[car]!;
      const ePos = ref.ePos[car]!;
      // the stored candidates are the call's (the hash matched)
      expect(JSON.stringify(mc.candidates[car]), `car ${car}: the stored candidates are its final call's`).toBe(JSON.stringify(candidates));
      expect(ePos.length, `car ${car}`).toBe(candidates.length);
      const best = ePos[ref.winner[car]!]!;
      expect(best, `car ${car}: the reference's winner has the least E[position]`).toBe(Math.min(...ePos));
      const regrets = GOOD_SEEDS.map((seed) => {
        const winner = raceMonteCarlo(structuredClone(mc), createRng(seed), mc.config.maxScenarioPolicies)[car]?.rows[0];
        expect(winner, `car ${car} seed ${seed}`).toBeDefined();
        const k = candidates.findIndex((c) => JSON.stringify(c.policy) === JSON.stringify(winner!.policy));
        expect(k, `car ${car} seed ${seed}: the pick is a stored candidate`).toBeGreaterThanOrEqual(0);
        return ePos[k]! - best;
      });
      const mean = regrets.reduce((s, r) => s + r, 0) / regrets.length;
      const worst = Math.max(...regrets);
      console.info(`[strategy good selection] car ${car}: regret per seed ${regrets.map((r) => r.toFixed(3)).join(' ')}; mean ${mean.toFixed(3)}, worst ${worst.toFixed(3)}; ${candidates.length} candidates, cap ${mc.config.maxScenarioPolicies}`);
      expect(mean, `car ${car}: mean regret`).toBeLessThanOrEqual(MEAN_REGRET);
      expect(worst, `car ${car}: worst regret`).toBeLessThanOrEqual(WORST_REGRET);
    }
  }, 600_000);
});
