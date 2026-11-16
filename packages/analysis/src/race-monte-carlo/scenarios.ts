// One scenario (SP4.3b spec §7.1): its neutralisations drawn from `race-hazard`'s tables, and every car's policy in it
// (our cars' stop lists, SP4.3d spec §5.1, with their SC/VSC reaction, §5.2, `reaction.ts`). Every draw is keyed by (scenario, car, lap, purpose) under the
// run's base seed (C2, S25), so a scenario is the same for every candidate (common random numbers).
import type { ForecastResult, Policy, Scenario, StartingPoint } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { drawsInto, streamKey, uniform, type Draws } from '../race-forecast/draws.ts';
import { raceForecast } from '../race-forecast/index.ts';
import { MC_PURPOSE } from './constants.ts';
import { hasStopAhead, rivalPlan, rivalStops } from './rivals.ts';
import { reactedPolicy } from './reaction.ts';
import type { McInput, Reactions, RivalRules } from './types.ts';
import { drawWeather, wetnessPath, type WeatherLap } from './weather.ts';

type Neutralisation = Scenario['neutralisations'][number];

/** The index of a pmf (index 0 first) the uniform `u` falls in; the last positive entry when the pmf sums below `u`. */
function pick(pmf: ArrayLike<number>, u: number): number {
  let s = 0;
  let last = 0;
  for (let i = 0; i < pmf.length; i++) {
    const p = pmf[i] ?? 0;
    if (p <= 0) continue;
    last = i;
    s += p;
    if (u < s) return i;
  }
  return last;
}

/** The streams of scenario `id` under base seed `base` (one per car slot, the session's at slot `start.cars`). */
export const scenarioDraws = (start: StartingPoint, base: number, id: number): Draws => drawsInto(base, id, new Int32Array(start.cars + 1));

/**
 * The neutralisations of one scenario. `hazard.byLap[i]` and `vscByLap[i]` are the start chances on lap `start.lap + i`;
 * one lasting d laps from lap n is out on n … n + d − 1 (`scDur[d − 1]`). None of the drawn ones starts while one drawn
 * before it is out or on the lap after it ends. One out now (`active`) runs from `start.lap` for its drawn laps left;
 * when a new one may start after it is `race-hazard`'s `allowed`, already in its chances, so no lap is blocked here.
 */
export function drawNeutralisations(start: StartingPoint, hazard: McInput['hazard'], draws: Draws): Neutralisation[] {
  const key = streamKey(draws, start.cars, 0);
  const out: Neutralisation[] = [];
  let free = start.lap;
  if (hazard.active !== null) {
    const left = pick(hazard.active.remaining, uniform(key, MC_PURPOSE.activeLength, 0));
    const toLap = Math.min(start.lap + left, start.lapsTotal);
    out.push({ kind: hazard.active.condition, fromLap: start.lap, toLap });
  }
  for (let i = 0; i < hazard.byLap.length; i++) {
    const lap = start.lap + i;
    if (lap > start.lapsTotal) break;
    if (lap < free) continue;
    let kind: 'sc' | 'vsc' | null = null;
    let laps = 0;
    if (uniform(key, MC_PURPOSE.scStart, lap) < (hazard.byLap[i] ?? 0)) {
      kind = 'sc';
      laps = 1 + pick(hazard.scDur, uniform(key, MC_PURPOSE.scLength, lap));
    } else if (uniform(key, MC_PURPOSE.vscStart, lap) < (hazard.vscByLap[i] ?? 0)) {
      kind = 'vsc';
      laps = 1 + pick(hazard.vscDur, uniform(key, MC_PURPOSE.vscLength, lap));
    }
    if (kind === null) continue;
    const toLap = Math.min(lap + laps - 1, start.lapsTotal);
    out.push({ kind, fromLap: lap, toLap });
    free = toLap + 2;
  }
  return out;
}

/**
 * One scenario as every candidate shares it: its neutralisations and wetness path, the rivals' policies (and their dry
 * stop laps, -1 none), its rain timeline (`null` without a forecast).
 */
export type ScenarioEntry = { scenario: Scenario; rivals: Policy[]; rivalLaps: Int16Array; weather: WeatherLap[] | null };

/** A run's fixed parts: the starting point, our cars, the two base seeds, the scenarios drawn so far, the calls made. */
export type Run = {
  start: StartingPoint;
  hazard: McInput['hazard'];
  rules: RivalRules;
  /** Our cars (the cars of `start.sets`), and per car slot the policy it follows unless scored (rivals: none). */
  ours: ReadonlySet<number>;
  fixed: (Policy | null)[];
  /** `race-forecast`'s generator: always its one base seed, so every forecast of a scenario shares its draws. */
  forecastRng: Rng;
  /** `forecastRng`'s base seed: the scenario's pace and degradation draws are `race-forecast`'s under it. */
  forecastBase: number;
  mcBase: number;
  scenarios: Map<number, ScenarioEntry>;
  /** `raceForecast` calls made: each counts against the cap (spec §7.3). */
  calls: number;
  /** The `raceForecast` calls one evaluation may take: 2 with the rivals' cover rule (a traced run to our stop first). */
  cost: number;
  /** Our cars' SC/VSC reaction tables (spec §5.2, `reaction.ts`); a car without one plays its stops as listed. */
  reactions: Reactions;
};

const NONE: Policy = { stops: [] };

export function createRun(start: StartingPoint, hazard: McInput['hazard'], rules: RivalRules, fixed: Record<number, Policy | null>, rng: Rng, reactions: Reactions = {}): Run {
  const forecastBase = rng.int(0, 2_147_483_647);
  const mcBase = rng.int(0, 2_147_483_647);
  const ours = new Set(Object.keys(start.sets).map(Number));
  return {
    start,
    hazard,
    rules,
    ours,
    fixed: Array.from({ length: start.cars }, (_, c) => (ours.has(c) ? (fixed[c] ?? NONE) : null)),
    forecastRng: { next: () => 0, int: () => forecastBase },
    forecastBase,
    mcBase,
    scenarios: new Map(),
    calls: 0,
    cost: rules.coverRule ? 2 : 1,
    reactions,
  };
}

/** Scenario `id` (drawn once, then reused by every candidate): its neutralisations, its weather and the rivals' stops. */
export function scenarioOf(run: Run, id: number): ScenarioEntry {
  const cached = run.scenarios.get(id);
  if (cached !== undefined) return cached;
  const { start } = run;
  const draws = scenarioDraws(start, run.mcBase, id);
  const scenario: Scenario = { id, plain: false, neutralisations: drawNeutralisations(start, run.hazard, draws) };
  const weather = drawWeather(start, draws);
  if (weather !== null) scenario.wetnessByLap = wetnessPath(weather);
  const rivalLaps = new Int16Array(start.cars);
  rivalStops(start, run.ours, scenario, run.rules, draws, rivalLaps);
  const rivals = Array.from({ length: start.cars }, (_, k) => (run.ours.has(k) ? NONE : rivalPlan(start, k, rivalLaps[k] ?? -1, weather, scenario.neutralisations, run.rules.reactionLaps)));
  const entry: ScenarioEntry = { scenario, rivals, rivalLaps, weather };
  run.scenarios.set(id, entry);
  return entry;
}

/** Scenario `id` as `raceMonteCarlo`, `scoreAll` and `fieldPositions` draw it for `input` under `rng`: its rain timeline and every slot's rival policy. */
export function drawnScenario(input: McInput, rng: Rng, id: number): { weather: WeatherLap[]; rivals: Policy[] } {
  const run = createRun(input.start, input.hazard, input.rivalRules, {}, rng);
  const entry = scenarioOf(run, id);
  const { start } = input;
  const weather = entry.weather ?? Array.from({ length: Math.max(0, start.lapsTotal - start.lap + 1) }, (_, i) => ({ lap: start.lap + i, rain: false, wetnessMs: start.wetness.wetnessMs }));
  return { weather, rivals: entry.rivals };
}

/** One `raceForecast` call, counted. */
export function forecast(run: Run, policies: readonly Policy[], scenario: Scenario, opts?: { trace?: boolean; toLap?: number }): ForecastResult {
  run.calls++;
  return raceForecast(run.start, policies, scenario, run.forecastRng, opts);
}

/**
 * Every car's policy in scenario `id`: our car `car` following `policy` and our other cars their fixed plans (`car` -1:
 * all of them), each a stop list played with its reaction table's SC/VSC reaction (as listed without one); the rivals their drawn stops (and covers).
 */
export function policiesIn(run: Run, id: number, car: number, policy: Policy | null): Policy[] {
  const entry = scenarioOf(run, id);
  const policies = entry.rivals.slice();
  const { neutralisations } = entry.scenario;
  // one out at the run's start is drawn first and brings no choice: the plan scored is the call made under it
  const skip = run.hazard.active === null ? 0 : 1;
  for (const c of run.ours) {
    const own = c === car && policy !== null ? policy : (run.fixed[c] ?? NONE);
    const table = run.reactions[c];
    const played = table === undefined || neutralisations.length <= skip ? own : reactedPolicy(table, run.start, c, own, neutralisations, skip);
    policies[c] = { stops: played.stops.map((s) => ({ lap: s.lap, compound: s.compound })) };
  }
  if (run.rules.coverRule) cover(run, policies, entry);
  return policies;
}

/**
 * The cover rule (spec §7.2 ablation): a rival ahead of our stopping car by at most `rules.coverGapMs` at the line ending our
 * in-lap, with a stop still ahead later than the next lap, stops on the next lap instead. One traced forecast to our
 * last stop finds the gaps.
 */
function cover(run: Run, policies: Policy[], drawn: ScenarioEntry): void {
  const { scenario, rivalLaps, weather } = drawn;
  const { start } = run;
  let last = -1;
  for (const c of run.ours) for (const s of policies[c]?.stops ?? []) if (s.lap >= start.lap && s.lap + 1 < start.lapsTotal) last = Math.max(last, s.lap);
  if (last === -1) return;
  const trace = forecast(run, policies, scenario, { trace: true, toLap: last }).trace ?? [];
  for (const c of run.ours) {
    for (const s of policies[c]?.stops ?? []) {
      const entry = trace.find((t) => t.lap === s.lap);
      const ourPos = entry?.position[c] ?? 0;
      if (entry === undefined || ourPos === 0 || s.lap + 1 >= start.lapsTotal) continue;
      for (let k = 0; k < start.cars; k++) {
        if (run.ours.has(k) || !hasStopAhead(start, k)) continue;
        const pos = entry.position[k] ?? 0;
        if (pos === 0 || pos >= ourPos || (entry.gapMs[c] ?? 0) - (entry.gapMs[k] ?? 0) > run.rules.coverGapMs) continue;
        const planned = rivalLaps[k] ?? -1;
        const now = policies[k]?.stops[0]?.lap ?? planned;
        if (now !== -1 && now <= s.lap + 1) continue;
        policies[k] = rivalPlan(start, k, s.lap + 1, weather, scenario.neutralisations, run.rules.reactionLaps);
      }
    }
  }
}
