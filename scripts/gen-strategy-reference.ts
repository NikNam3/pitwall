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
// candidate. The candidates are built as `strategy`'s job builds them (`job.ts`: the plain forecast's road, the traffic
// term, the DP's input, `candidatesOf`); job.ts exports none of these steps, so they are restated here.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOISE_COMPOUNDS, type CarId, type NoiseCompound, type Policy, type RaceHazard, type StartingPoint } from '../packages/domain/src/index.ts';
import { createRng, type Rng } from '../packages/engine/src/readers.ts';
import { raceForecast, startLapOf } from '../packages/analysis/src/race-forecast/index.ts';
import { rivalNextCompound, scoreAll, type McCandidate, type McConfig, type McInput } from '../packages/analysis/src/race-monte-carlo/index.ts';
import { candidatesOf, prepareStrategy, STRATEGY_CONFIG, type StrategyConfig } from '../packages/analysis/src/strategy/index.ts';
import { strategyDp, type DpInput } from '../packages/analysis/src/strategy-dp/index.ts';
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

// --- the job's candidate step (`strategy/job.ts`), restated --------------------------------------------------------

type Hazard = McInput['hazard'];

/** `race-hazard`'s tables per lap from the leader's lap (index 0 = `start.lap`); without them, no neutralisation drawn. */
function hazardOf(start: StartingPoint, hazard: RaceHazard): Hazard {
  const n = Math.max(0, start.lapsTotal - start.lap + 1);
  const byLap = new Float64Array(n);
  const vscByLap = new Float64Array(n);
  if (!hazard.known) return { byLap, vscByLap, scDur: Float64Array.of(1), vscDur: Float64Array.of(1), active: null };
  const h = hazard.value;
  for (const entry of h.byLap) {
    const i = entry.lap - start.lap;
    if (i < 0 || i >= n) continue;
    byLap[i] = entry.sc;
    vscByLap[i] = entry.vsc;
  }
  const active = h.active === null ? null : { condition: h.active.condition, remaining: Float64Array.from(h.active.remainingLaps) };
  return { byLap, vscByLap, scDur: Float64Array.from(h.durationLaps.sc), vscDur: Float64Array.from(h.durationLaps.vsc), active };
}

type Road = Map<number, { gapMs: Float64Array; position: Int8Array }>;

/** The plain forecast's road: per lap from `start.lap` each car's gap to the leader at that lap's line (0 = retired). */
function plainRoad(start: StartingPoint, rng: Rng): Road {
  const ours = new Set(Object.keys(start.sets).map(Number));
  const policies: Policy[] = Array.from({ length: start.cars }, (_, k): Policy => {
    const compound = ours.has(k) ? null : rivalNextCompound(start, k);
    const lap = start.stopMid[k] ?? start.lapsTotal;
    return compound === null || lap < start.lap || lap >= start.lapsTotal ? { stops: [], triggers: [] } : { stops: [{ lap, compound }], triggers: [] };
  });
  const result = raceForecast(start, policies, { id: 0, plain: true, neutralisations: [] }, rng, { trace: true });
  return new Map((result.trace ?? []).map((t) => [t.lap, { gapMs: t.gapMs, position: t.position }]));
}

/** Per lap from `fromLap` the traffic cost of a rejoin at its end: the shortfall to `trafficGapMs` of each car ahead within it. */
function trafficOf(start: StartingPoint, road: Road, car: CarId, fromLap: number, trafficGapMs: number): Float64Array {
  const out = new Float64Array(start.lapsTotal - fromLap + 1);
  for (let i = 0; i < out.length; i++) {
    const line = road.get(fromLap + i);
    if (line === undefined || (line.position[car] ?? 0) === 0) continue;
    const rejoin = (line.gapMs[car] ?? 0) + start.track.pitLossMs.green;
    let cost = 0;
    for (let k = 0; k < start.cars; k++) {
      if (k === car || (line.position[k] ?? 0) === 0) continue;
      const d = rejoin - (line.gapMs[k] ?? 0);
      if (d >= 0 && d < trafficGapMs) cost += trafficGapMs - d;
    }
    out[i] = cost;
  }
  return out;
}

/** The DP's input for car `car` from its lap `fromLap` (spec §6). */
function dpInputOf(start: StartingPoint, car: CarId, fromLap: number, hazard: Hazard, traffic: Float64Array): DpInput {
  const n = start.lapsTotal - fromLap + 1;
  const shifted = (a: Float64Array): Float64Array => Float64Array.from({ length: n }, (_, i) => a[fromLap + i - start.lap] ?? 0);
  const rate = start.wearRatePct[car] ?? 0;
  const wearRatePct = Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, rate])) as Record<NoiseCompound, number>;
  const sets = Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, 0])) as Record<NoiseCompound, number>;
  for (const s of start.sets[car] ?? []) if (s.wearPct <= 0) sets[s.compound] += 1;
  return {
    car,
    fromLap,
    totalLaps: start.lapsTotal,
    lap: start.lapModel,
    carParams: {
      compound: NOISE_COMPOUNDS[start.compound[car] ?? 1] ?? 'medium',
      tyreAge: start.tyreAge[car] ?? 0,
      wearPct: start.wearPct[car] ?? 0,
      fuelKg: start.fuelKg[car] ?? 0,
      paceMs: start.paceMs[car] ?? 0,
      degMsPerLap: start.degMsPerLap[car] ?? 0,
      wearRatePct,
      human: start.human[car] === 1,
    },
    sets,
    owesSecondCompound: start.owesStop[car] === 1,
    pitLossMs: start.track.pitLossMs,
    hazard: { byLap: shifted(hazard.byLap), vscByLap: shifted(hazard.vscByLap), scDur: hazard.scDur, vscDur: hazard.vscDur },
    active: hazard.active,
    wetnessByLap: new Float64Array(n).fill(start.wetness.wetnessMs),
    trafficMsByLap: traffic,
  };
}

/** The search's settings from the config (spec §7.3, §11.1). */
const mcConfigOf = (config: StrategyConfig): McConfig => ({
  n0: config.n0,
  zDrop: config.zDrop,
  zTie: config.zTie,
  tieBand: config.tieBand,
  rescoreTop: config.rescoreTop,
  maxScenarioPolicies: config.maxScenarioPolicies,
  points: String(config.points).split(',').map((p) => Number(p.trim())),
});

/** The test race's `race-monte-carlo` input: both our cars' candidates, neither committed, the config's search settings. */
export function strategyReferenceInput(): McInput {
  const config = STRATEGY_CONFIG.defaults;
  const race = generateRace(GENERATOR_DEFAULTS, RACE_SEED).race;
  const input = prepareStrategy(viewAt(race, LAP, { frameOfLap: FRAME_OF_LAP, config: { maxScenarioPolicies: config.maxScenarioPolicies } }));
  if (!input.start.known) throw new Error(`gen-strategy-reference: no starting point at lap ${LAP} (${input.start.reason})`);
  const start = input.start.value;
  const planned = input.planned.filter((car) => start.sets[car] !== undefined);
  if (planned.length !== OURS.length) throw new Error(`gen-strategy-reference: plans ${planned.join(', ')} of our cars ${OURS.join(', ')}`);

  const sets: StartingPoint['sets'] = {};
  for (const car of planned) sets[car] = start.sets[car] ?? [];
  const field: StartingPoint = { ...start, sets };
  const hazard = hazardOf(field, input.hazard);
  const road = plainRoad(field, createRng(SEED));
  const candidates: Record<CarId, McCandidate[]> = {};
  const committed: Record<CarId, Policy | null> = {};
  for (const car of planned) {
    const fromLap = startLapOf(field, car);
    const dp = strategyDp(dpInputOf(field, car, fromLap, hazard, trafficOf(field, road, car, fromLap, config.trafficGapMs)));
    candidates[car] = candidatesOf(field, car, dp, config);
    committed[car] = null;
  }
  const rivalRules = { q: config.rivalScBoxChance, aMin: config.rivalScMinTyreAge, reactionLaps: config.rivalReactionLaps, coverRule: false };
  return { start: field, candidates, committed, hazard, rivalRules, config: mcConfigOf(config) };
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
