// The good-selection reference (SP4.3b spec §7.4; plan 4.3b1 Task 20b): the test race's candidates from `strategy`'s
// candidate builder, each scored by `race-monte-carlo`'s `scoreAll` on the same 50,000 common scenarios (a full
// evaluation, no search, nothing dropped), written to `test-support/fixtures/strategy-reference.json` with a source hash
// over `packages/analysis/src/**` (tests excluded) and `test-support/race-generator/**`. `strategy.budget.test.ts` feeds
// the stored candidates to the capped search and compares its winner with the reference's.
//
// Run by `pnpm gen:strategy-reference` (the supervisor's, tens of minutes; not part of `pnpm gen`). `--scenarios <n>`
// scores fewer scenarios per candidate and `--out <file>` writes elsewhere (a smoke check only; the committed reference
// uses 50,000). Importing this module runs nothing.
//
// The test race: the generator's default race (20 cars, 50 laps, seed 1) seen from our two cars as `strategy`'s tests
// see it (`viewAt`: player 2 and teammate 5, the track file, their tyre sets, `race-hazard`'s output), at the first
// frame of the leader's lap `LAP`. Each car's reference comes from that car's part (SP4.3b Q4 D, Task 25): the input of
// the part's final call (`partFinalCall`, `strategy/job.ts`: the part's candidate step and round 1 drawn with `SEED`),
// so while the car is scored our other car follows what the part's final ranking holds it to. The candidates are the
// job's own (its candidate step, `candidatesForRun`; Task 20d).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarId } from '../packages/domain/src/index.ts';
import { createRng } from '../packages/engine/src/readers.ts';
import { scoreAll, type McCandidate, type McInput } from '../packages/analysis/src/race-monte-carlo/index.ts';
import { candidatesForRun, partFinalCall, prepareStrategy, splitStrategy, STRATEGY_CONFIG, type FinalCall, type StrategyInput } from '../packages/analysis/src/strategy/index.ts';
import { OURS, viewAt } from '../packages/analysis/test/strategy/support.ts';
import { generateRace, GENERATOR_DEFAULTS } from '../test-support/race-generator/index.ts';

const ROOT = join(import.meta.dirname, '..');

/** The fixture's absolute path. */
export const REFERENCE_FILE = join(ROOT, 'test-support', 'fixtures', 'strategy-reference.json');

/** The trees the source hash covers, relative to the root. */
const HASHED = ['packages/analysis/src', 'test-support/race-generator'];

/** Scenarios per candidate of the reference. Source: spec §7.4 (a 50,000-scenario reference). */
const REFERENCE_SCENARIOS = 50_000;
/** The seed of the reference's common scenarios and of the job's plain forecast. */
const SEED = 2_025;
/** The generator's seed. */
const RACE_SEED = 1;
/**
 * The leader's lap of the view, its first frame (as the budget test's view): lap 2, the first lap the starting point is
 * known (the leader has completed lap 1), where the most of the race is left to plan and so the most candidates.
 */
const LAP = 2;
const FRAME_OF_LAP = 0;

/** The fixture. Per our car its candidates, their E[position] in the candidates' order and the index of the least. */
export type StrategyReference = {
  sourceHash: string;
  generatorParams: unknown;
  candidates: Record<CarId, McCandidate[]>;
  ePos: Record<CarId, number[]>;
  winner: Record<CarId, number>;
};

/** Every file under `dir` (absolute), recursively, but test files (`*.test.ts`). */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (entry.isFile() && !entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/** sha256 over the hashed trees under `root`: each file's path relative to `root` (forward slashes) and its contents. */
export function strategyReferenceHash(root: string = ROOT): string {
  const hash = createHash('sha256');
  const files = HASHED.flatMap((dir) => filesUnder(join(root, dir)))
    .map((path) => ({ path, rel: relative(root, path).split(sep).join('/') }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  for (const { path, rel } of files) {
    const body = readFileSync(path);
    hash.update(`${rel}\0${body.length}\0`);
    hash.update(body);
  }
  return hash.digest('hex');
}

/** The generator's parameters as the fixture records them (JSON: the pass hazard, a function, is the default's). */
const generatorParams = (): unknown => ({ base: 'GENERATOR_DEFAULTS', seed: RACE_SEED, lap: LAP, frameOfLap: FRAME_OF_LAP, ours: OURS, params: JSON.parse(JSON.stringify(GENERATOR_DEFAULTS)) });

/** The test race's prepared input: the script's view, the config's cap. */
function referenceStrategyInput(): StrategyInput {
  const config = STRATEGY_CONFIG.defaults;
  const race = generateRace(GENERATOR_DEFAULTS, RACE_SEED).race;
  return prepareStrategy(viewAt(race, LAP, { frameOfLap: FRAME_OF_LAP, config: { maxScenarioPolicies: config.maxScenarioPolicies } }));
}

/** The test race's candidate step for the whole input (`candidatesForRun`): both our cars' candidates, neither committed, the config's search settings. */
export function strategyReferenceInput(): McInput {
  const { mc, perCar } = candidatesForRun(referenceStrategyInput(), createRng(SEED));
  if (mc === null || perCar.size !== OURS.length) throw new Error(`gen-strategy-reference: plans ${[...perCar.keys()].join(', ')} of our cars ${OURS.join(', ')} at lap ${LAP}`);
  return mc;
}

/** The test race's `race-monte-carlo` inputs, one per our car: its part's final call (neither committed, the config's search settings). */
export function strategyReferenceInputs(): FinalCall[] {
  const calls = splitStrategy(referenceStrategyInput()).flatMap((part) => {
    const { final } = partFinalCall(part, createRng(SEED));
    return final === null ? [] : [final];
  });
  const cars = calls.map((c) => c.car);
  if (cars.length !== OURS.length || !OURS.every((car) => cars.includes(car))) throw new Error(`gen-strategy-reference: plans ${cars.join(', ')} of our cars ${OURS.join(', ')} at lap ${LAP}`);
  return calls;
}

/** The reference: every candidate of the test race scored on `scenarios` common scenarios, per car in its part's final call. */
export function strategyReference(scenarios: number = REFERENCE_SCENARIOS): StrategyReference {
  const ePos: Record<CarId, number[]> = {};
  const winner: Record<CarId, number> = {};
  const candidates: Record<CarId, McCandidate[]> = {};
  for (const { car, mc } of strategyReferenceInputs()) {
    const list = mc.candidates[car] ?? [];
    candidates[car] = list;
    const rows = scoreAll(mc, createRng(SEED), scenarios)[car]?.rows ?? [];
    ePos[car] = list.map((c, k) => {
      const policy = JSON.stringify(c.policy);
      const row = rows.find((r) => JSON.stringify(r.policy) === policy);
      if (row === undefined) throw new Error(`gen-strategy-reference: car ${car}'s candidate #${k} has no row`);
      return row.ePos;
    });
    const best = Math.min(...ePos[car]);
    winner[car] = ePos[car].indexOf(best);
  }
  return { sourceHash: strategyReferenceHash(), generatorParams: generatorParams(), candidates, ePos, winner };
}

/** The value of `--name <value>` in `argv`, or `undefined`. */
const arg = (argv: readonly string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

function main(argv: readonly string[]): void {
  const scenarios = Number(arg(argv, '--scenarios') ?? REFERENCE_SCENARIOS);
  if (!Number.isInteger(scenarios) || scenarios < 1) throw new Error(`gen-strategy-reference: --scenarios must be a positive integer`);
  const out = arg(argv, '--out') ?? REFERENCE_FILE;
  const ref = strategyReference(scenarios);
  writeFileSync(out, `${JSON.stringify(ref, null, 2)}\n`);
  const counts = Object.entries(ref.candidates).map(([car, list]) => `car ${car}: ${list.length} candidates, winner #${ref.winner[Number(car) as CarId]}`);
  console.info(`gen-strategy-reference: ${scenarios} scenarios per candidate; ${counts.join('; ')}; wrote ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv);
