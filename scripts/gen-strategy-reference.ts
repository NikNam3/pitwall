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
// frame of the leader's lap `LAP`. Its input is one `race-monte-carlo` call with both our cars' candidates and the
// config's search settings (the supervisor's ruling): while one car is scored our other car follows its first
// candidate. The candidates are the job's own: its candidate step, `candidatesForRun` (`strategy/job.ts`; Task 20d).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarId } from '../packages/domain/src/index.ts';
import { createRng } from '../packages/engine/src/readers.ts';
import { scoreAll, type McCandidate, type McInput } from '../packages/analysis/src/race-monte-carlo/index.ts';
import { candidatesForRun, prepareStrategy, STRATEGY_CONFIG } from '../packages/analysis/src/strategy/index.ts';
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

/** The test race's `race-monte-carlo` input: both our cars' candidates, neither committed, the config's search settings. */
export function strategyReferenceInput(): McInput {
  const config = STRATEGY_CONFIG.defaults;
  const race = generateRace(GENERATOR_DEFAULTS, RACE_SEED).race;
  const input = prepareStrategy(viewAt(race, LAP, { frameOfLap: FRAME_OF_LAP, config: { maxScenarioPolicies: config.maxScenarioPolicies } }));
  const { mc, perCar } = candidatesForRun(input, createRng(SEED));
  if (mc === null || perCar.size !== OURS.length) throw new Error(`gen-strategy-reference: plans ${[...perCar.keys()].join(', ')} of our cars ${OURS.join(', ')} at lap ${LAP}`);
  return mc;
}

/** The reference: every candidate of the test race scored on `scenarios` common scenarios. */
export function strategyReference(scenarios: number = REFERENCE_SCENARIOS): StrategyReference {
  const input = strategyReferenceInput();
  const result = scoreAll(input, createRng(SEED), scenarios);
  const ePos: Record<CarId, number[]> = {};
  const winner: Record<CarId, number> = {};
  for (const [key, list] of Object.entries(input.candidates)) {
    const car = Number(key) as CarId;
    const rows = result[car]?.rows ?? [];
    ePos[car] = list.map((c, k) => {
      const policy = JSON.stringify(c.policy);
      const row = rows.find((r) => JSON.stringify(r.policy) === policy);
      if (row === undefined) throw new Error(`gen-strategy-reference: car ${car}'s candidate #${k} has no row`);
      return row.ePos;
    });
    const best = Math.min(...ePos[car]);
    winner[car] = ePos[car].indexOf(best);
  }
  return { sourceHash: strategyReferenceHash(), generatorParams: generatorParams(), candidates: input.candidates, ePos, winner };
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
