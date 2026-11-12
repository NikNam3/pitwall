// One scenario (SP4.3b spec §7.1): its neutralisations drawn from `race-hazard`'s tables, and our cars' policies as
// they play out in it (their triggers fired). Every draw is keyed by (scenario, car, lap, purpose) under the run's base
// seed (C2, S25), so a scenario is the same for every candidate (common random numbers).
import type { ForecastResult, NoiseCompound, Policy, Scenario, StartingPoint } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { drawsInto, streamKey, uniform, type Draws } from '../race-forecast/draws.ts';
import { raceForecast } from '../race-forecast/index.ts';
import { COVER_GAP_MS, MC_PURPOSE } from './constants.ts';
import { hasStopAhead, rivalNextCompound, rivalStops } from './rivals.ts';
import type { McInput, RivalRules } from './types.ts';

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
 * one lasting d laps from lap n is out on n … n + d − 1 (`scDur[d − 1]`). None starts while one is out or on the lap
 * after it ends (`race-hazard`). One out now (`active`) runs from `start.lap` for its drawn laps left.
 */
export function drawNeutralisations(start: StartingPoint, hazard: McInput['hazard'], draws: Draws): Neutralisation[] {
  const key = streamKey(draws, start.cars, 0);
  const out: Neutralisation[] = [];
  let free = start.lap;
  if (hazard.active !== null) {
    const left = pick(hazard.active.remaining, uniform(key, MC_PURPOSE.activeLength, 0));
    const toLap = Math.min(start.lap + left, start.lapsTotal);
    out.push({ kind: hazard.active.condition, fromLap: start.lap, toLap });
    free = toLap + 2;
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
 * Our car's policy as it plays out under `neutralisations`: per trigger (in order) whether its condition held and the
 * car acted (`fired`). A `neutralised` trigger holds on the first lap of its range a neutralisation of its condition is
 * out: `box` boxes at the end of that lap (in place of the next planned stop, else as one more), `stayOut` moves every
 * planned stop inside that neutralisation to the first lap after it. The other kinds need a model 4.3b1's starting
 * point does not carry (rain timeline, damage, a wear-rate change, rivals' gaps): they never fire.
 */
export function playOut(policy: Policy, neutralisations: readonly Neutralisation[], lapsTotal: number, fired: Uint8Array): Policy {
  let stops: { lap: number; compound: NoiseCompound }[] = policy.stops.map((s) => ({ lap: s.lap, compound: s.compound }));
  policy.triggers.forEach((t, i) => {
    fired[i] = 0;
    if (t.kind !== 'neutralised') return;
    const n = neutralisations.find((x) => x.kind === t.condition && Math.max(x.fromLap, t.fromLap) <= Math.min(x.toLap, t.toLap));
    if (n === undefined) return;
    fired[i] = 1;
    if (t.action === 'stayOut') {
      stops = stops.map((s) => (s.lap >= n.fromLap && s.lap <= n.toLap ? { lap: n.toLap + 1, compound: s.compound } : s)).filter((s) => s.lap < lapsTotal);
      return;
    }
    const lap = Math.max(n.fromLap, t.fromLap);
    if (stops.some((s) => s.lap === lap)) return;
    const next = stops.findIndex((s) => s.lap > lap);
    if (next === -1) stops.push({ lap, compound: t.action.box });
    else stops[next] = { lap, compound: t.action.box };
  });
  stops.sort((a, b) => a.lap - b.lap);
  return { stops, triggers: [] };
}

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
  mcBase: number;
  scenarios: Map<number, { scenario: Scenario; rivals: Policy[]; rivalLaps: Int16Array }>;
  /** `raceForecast` calls made: each counts against the cap (spec §7.3). */
  calls: number;
  /** The `raceForecast` calls one evaluation may take: 2 with the cover rule (a traced run to our stop first). */
  cost: number;
};

const NONE: Policy = { stops: [], triggers: [] };

export function createRun(start: StartingPoint, hazard: McInput['hazard'], rules: RivalRules, fixed: Record<number, Policy | null>, rng: Rng): Run {
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
    mcBase,
    scenarios: new Map(),
    calls: 0,
    cost: rules.coverRule ? 2 : 1,
  };
}

/** Scenario `id` (drawn once, then reused by every candidate): its neutralisations and the rivals' stops. */
export function scenarioOf(run: Run, id: number): { scenario: Scenario; rivals: Policy[]; rivalLaps: Int16Array } {
  const cached = run.scenarios.get(id);
  if (cached !== undefined) return cached;
  const { start } = run;
  const draws = scenarioDraws(start, run.mcBase, id);
  const scenario: Scenario = { id, plain: false, neutralisations: drawNeutralisations(start, run.hazard, draws) };
  const rivalLaps = new Int16Array(start.cars);
  rivalStops(start, run.ours, scenario, run.rules, draws, rivalLaps);
  const rivals = Array.from({ length: start.cars }, (_, k) => rivalPolicy(start, k, rivalLaps[k] ?? -1));
  const entry = { scenario, rivals, rivalLaps };
  run.scenarios.set(id, entry);
  return entry;
}

function rivalPolicy(start: StartingPoint, k: number, lap: number): Policy {
  const compound = rivalNextCompound(start, k);
  return lap === -1 || compound === null ? NONE : { stops: [{ lap, compound }], triggers: [] };
}

/** One `raceForecast` call, counted. */
export function forecast(run: Run, policies: readonly Policy[], scenario: Scenario, opts?: { trace?: boolean; toLap?: number }): ForecastResult {
  run.calls++;
  return raceForecast(run.start, policies, scenario, run.forecastRng, opts);
}

/**
 * Every car's policy in scenario `id`, our car `car` following `policy` (its triggers' firing into `fired`) and our
 * other cars their fixed plans played out (`car` -1: all of them), the rivals their drawn stops (and covers).
 */
export function policiesIn(run: Run, id: number, car: number, policy: Policy | null, fired: Uint8Array): Policy[] {
  const { scenario, rivals, rivalLaps } = scenarioOf(run, id);
  const policies = rivals.slice();
  for (const c of run.ours) {
    const own = c === car && policy !== null ? policy : (run.fixed[c] ?? NONE);
    policies[c] = playOut(own, scenario.neutralisations, run.start.lapsTotal, c === car ? fired : new Uint8Array(own.triggers.length));
  }
  if (run.rules.coverRule) cover(run, policies, scenario, rivalLaps);
  return policies;
}

/**
 * The cover rule (spec §7.2 ablation): a rival ahead of our stopping car by at most `COVER_GAP_MS` at the line ending our
 * in-lap, with a stop still ahead later than the next lap, stops on the next lap instead. One traced forecast to our
 * last stop finds the gaps.
 */
function cover(run: Run, policies: Policy[], scenario: Scenario, rivalLaps: Int16Array): void {
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
        if (pos === 0 || pos >= ourPos || (entry.gapMs[c] ?? 0) - (entry.gapMs[k] ?? 0) > COVER_GAP_MS) continue;
        const planned = rivalLaps[k] ?? -1;
        const now = policies[k]?.stops[0]?.lap ?? planned;
        if (now !== -1 && now <= s.lap + 1) continue;
        policies[k] = rivalPolicy(start, k, s.lap + 1);
      }
    }
  }
}
