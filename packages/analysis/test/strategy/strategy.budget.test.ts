// `strategy`'s budget (SP4.3b spec §8.1, §11.2, S26; plan 4.3b1 Task 20 row 12, ported in Task 25): on the long-race
// builder (70 laps, 20 cars) at lap 1 (the first frame the starting point is known: the leader has completed lap 1),
// `prepare` under 20 ms and one car's part (SP4.3b Q4 D: one part per our car, each at the config's
// `maxScenarioPolicies`, one worker each) within 5 s single thread. The cap is a count (C2): a miss lowers the count,
// never raises the budget. Best of warm passes (docs/testing.md).
//
// Good selection (spec §7.4; plan 4.3b1 Task 20b, ported in Task 25): each car's part at the config's
// `maxScenarioPolicies` gives a winner whose reference E[position] lies within 0.05 places of the reference's winner
// for that car. The reference (`test-support/fixtures/strategy-reference.json`, 50,000 scenarios per candidate) is
// never computed here: `pnpm gen:strategy-reference` makes it (supervisor, tens of minutes), each car's candidates and
// reference from that car's part.
//
// How this row reads the script (the test agent's decisions, Task 20b and Task 25 reports):
// `scripts/gen-strategy-reference.ts` exports `REFERENCE_FILE` (the fixture's absolute path), the fixture's type
// `StrategyReference` (`sourceHash`, `generatorParams`, per our car `candidates: McCandidate[]`, `ePos: number[]` in the
// candidates' order and `winner`, the index of the least E[position]) and `strategyReferenceHash()`; importing it runs
// nothing. Its view is the generator's default race (seed 1) at the first frame of the leader's lap 2, the config's
// cap; its seed 2,025. A part run with that seed draws the script's plain forecast, so its candidates are the stored
// ones (`candidatesForRun` on the part, the same seed).
import { existsSync, readFileSync } from 'node:fs';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { REFERENCE_FILE, strategyReferenceHash, type StrategyReference } from '../../../../scripts/gen-strategy-reference.ts';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS } from '../../../../test-support/race-generator/index.ts';
import { candidatesForRun, prepareStrategy, runStrategy, STRATEGY_CONFIG } from '../../src/strategy/index.ts';
import { jobParts, OURS, viewAt } from './support.ts';

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

/** The script's seed: its plain forecast's and its common scenarios' (`scripts/gen-strategy-reference.ts`). */
const REFERENCE_SEED = 2_025;

const PREPARE_MS = 20;
const JOB_MS = 5_000;

describe('strategy budget', () => {
  // row 12, ported in Task 25: each car's part at the whole cap
  it('budget: prepare under 20 ms; one car\'s part at maxScenarioPolicies finishes within 5 s single thread at lap 1 of the long race', () => {
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
      console.info(`[strategy budget] prepare ${prepareBest.toFixed(1)} ms, car ${car}'s part ${partBest.toFixed(0)} ms at cap ${cap} (long race, lap 1)`);
      expect(partBest, `car ${car}'s part`).toBeLessThan(JOB_MS);
    }
    expect(prepareBest).toBeLessThan(PREPARE_MS);
  }, 120_000);

  // Task 20b, ported in Task 25: each car's capped winner from its part
  it('good selection: each car\'s part at the cap (maxScenarioPolicies from config) gives a winner within 0.05 places of the reference\'s; a reference whose sourceHash differs fails with "regenerate the reference"', () => {
    const ref = reference();
    const cap = STRATEGY_CONFIG.defaults.maxScenarioPolicies;
    const race = generateRace(GENERATOR_DEFAULTS, 1).race;
    const input = structuredClone(prepareStrategy(viewAt(race, 2, { frameOfLap: 0, config: { maxScenarioPolicies: cap } })));
    const parts = jobParts().split(input);
    expect(parts.map((p) => p.planCar), 'one part per our car').toEqual([...OURS]);

    for (const part of parts) {
      const car = part.planCar!;
      const candidates = ref.candidates[car]!;
      const ePos = ref.ePos[car]!;
      // the stored candidates are the part's (the hash matched)
      const own = candidatesForRun(structuredClone(part), createRng(REFERENCE_SEED)).perCar.get(car)?.candidates;
      expect(JSON.stringify(own), `car ${car}: the stored candidates are its part's`).toBe(JSON.stringify(candidates));
      expect(ePos.length, `car ${car}`).toBe(candidates.length);
      const best = ePos[ref.winner[car]!]!;
      expect(best, `car ${car}: the reference's winner has the least E[position]`).toBe(Math.min(...ePos));
      const r = runStrategy(structuredClone(part), createRng(REFERENCE_SEED))[car];
      expect(r?.known, `car ${car}`).toBe(true);
      const winner = r!.known ? r!.value.rows[0] : undefined;
      expect(winner, `car ${car}`).toBeDefined();
      const k = candidates.findIndex((c) => JSON.stringify(c.policy) === JSON.stringify(winner!.policy));
      expect(k, `car ${car}: the capped winner is a stored candidate`).toBeGreaterThanOrEqual(0);
      console.info(`[strategy good selection] car ${car}: capped winner #${k} ref E[pos] ${ePos[k]!.toFixed(3)}, reference winner #${ref.winner[car]} ${best.toFixed(3)}, ${candidates.length} candidates, cap ${cap}`);
      expect(ePos[k]! - best, `car ${car}`).toBeLessThanOrEqual(GOOD_SELECTION_PLACES);
    }
  }, 180_000);
});
