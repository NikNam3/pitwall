// One scenario (SP4.3b spec §7.1): its neutralisations drawn from `race-hazard`'s tables, and our cars' policies as
// they play out in it (their triggers fired). Every draw is keyed by (scenario, car, lap, purpose) under the run's base
// seed (C2, S25), so a scenario is the same for every candidate (common random numbers).
import type { ForecastResult, NoiseCompound, Policy, Scenario, StartingPoint } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { drawsInto, normal, PURPOSE, streamKey, uniform, type Draws } from '../race-forecast/draws.ts';
import { raceForecast } from '../race-forecast/index.ts';
import { COVER_GAP_MS, MC_PURPOSE } from './constants.ts';
import { hasStopAhead, rivalPlan, rivalStops } from './rivals.ts';
import type { McInput, RivalRules } from './types.ts';
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

type Stop = { lap: number; compound: NoiseCompound };

/** Boxes at the end of `lap` for `compound`: in place of the next planned stop after it, else as one more (none if one is planned there). */
function boxAt(stops: Stop[], lap: number, compound: NoiseCompound): void {
  if (stops.some((s) => s.lap === lap)) return;
  const next = stops.findIndex((s) => s.lap > lap);
  if (next === -1) stops.push({ lap, compound });
  else stops[next] = { lap, compound };
}

/** What a scenario holds for one of our cars' triggers: its neutralisations, its rain timeline, the car's wear rate in it. */
export type PlayContext = {
  neutralisations: readonly Neutralisation[];
  lapsTotal: number;
  weather: readonly WeatherLap[] | null;
  /** The scenario's wear rate less the car's estimate (% a lap; spec §7.1's pace uncertainty). */
  wearRateOffPct: number;
};

/**
 * Our car's policy as it plays out in one scenario: per trigger (in order) whether its condition held and the car acted
 * (`fired`).
 * - `neutralised` holds on the first lap of its range a neutralisation of its condition is out: `box` boxes at the end
 *   of that lap (in place of the next planned stop, else as one more), `stayOut` moves every planned stop inside that
 *   neutralisation to the first lap after it.
 * - `rain` holds on the first lap before the flag whose wetness is at least its `wetnessMs`: it boxes at the end of it.
 * - `degradationOff` holds when the scenario's wear rate is above the car's estimate by at least `wearRateDeltaPct`:
 *   the car follows `switchTo` instead of its stops.
 * - `rivalPits` needs the field's gaps (`rivalPits`, after this); `damage` never fires: driver-noise's mistakes carry
 *   no damage size (Task 19b).
 */
export function playOut(policy: Policy, ctx: PlayContext, fired: Uint8Array): Policy {
  const { neutralisations, lapsTotal } = ctx;
  let stops: Stop[] = policy.stops.map((s) => ({ lap: s.lap, compound: s.compound }));
  policy.triggers.forEach((t, i) => {
    fired[i] = 0;
    if (t.kind === 'rain') {
      const at = ctx.weather?.find((w) => w.wetnessMs >= t.wetnessMs);
      if (at === undefined || at.lap >= lapsTotal) return;
      fired[i] = 1;
      boxAt(stops, at.lap, t.action.box);
      return;
    }
    if (t.kind === 'degradationOff') {
      if (!(ctx.wearRateOffPct >= t.wearRateDeltaPct)) return;
      fired[i] = 1;
      stops = t.action.switchTo.map((s) => ({ lap: s.lap, compound: s.compound }));
      return;
    }
    if (t.kind !== 'neutralised') return;
    const n = neutralisations.find((x) => x.kind === t.condition && Math.max(x.fromLap, t.fromLap) <= Math.min(x.toLap, t.toLap));
    if (n === undefined) return;
    fired[i] = 1;
    if (t.action === 'stayOut') {
      stops = stops.map((s) => (s.lap >= n.fromLap && s.lap <= n.toLap ? { lap: n.toLap + 1, compound: s.compound } : s)).filter((s) => s.lap < lapsTotal);
      return;
    }
    boxAt(stops, Math.max(n.fromLap, t.fromLap), t.action.box);
  });
  stops.sort((a, b) => a.lap - b.lap);
  return { stops, triggers: [] };
}

/**
 * One scenario as every candidate shares it: its neutralisations and wetness path, the rivals' policies (and their dry
 * stop laps, -1 none), its rain timeline (`null` without a forecast), per car slot the wear rate's offset (our cars).
 */
export type ScenarioEntry = { scenario: Scenario; rivals: Policy[]; rivalLaps: Int16Array; weather: WeatherLap[] | null; wearRateOffPct: Float64Array };

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
    forecastBase,
    mcBase,
    scenarios: new Map(),
    calls: 0,
    cost: rules.coverRule ? 2 : 1,
  };
}

/**
 * Our cars' wear rate in scenario `id` less its estimate: `wearRatePct` scaled by the scenario's degradation slope (the
 * draw `race-forecast` makes under the run's forecast seed) over its estimate (spec §7.1's pace uncertainty).
 */
function wearRateOff(run: Run, id: number): Float64Array {
  const { start } = run;
  const out = new Float64Array(start.cars);
  const draws = drawsInto(run.forecastBase, id, new Int32Array(start.cars));
  for (const c of run.ours) {
    const deg = start.degMsPerLap[c] ?? 0;
    const sd = start.degSdMs[c] ?? 0;
    if (!(deg > 0) || sd === 0) continue;
    const drawn = deg + sd * normal(streamKey(draws, c, 0), PURPOSE.deg, 0);
    out[c] = (start.wearRatePct[c] ?? 0) * (drawn / deg - 1);
  }
  return out;
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
  const entry: ScenarioEntry = { scenario, rivals, rivalLaps, weather, wearRateOffPct: wearRateOff(run, id) };
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
 * Every car's policy in scenario `id`, our car `car` following `policy` (its triggers' firing into `fired`) and our
 * other cars their fixed plans played out (`car` -1: all of them), the rivals their drawn stops (and covers).
 */
export function policiesIn(run: Run, id: number, car: number, policy: Policy | null, fired: Uint8Array): Policy[] {
  const entry = scenarioOf(run, id);
  const { scenario, rivals } = entry;
  const policies = rivals.slice();
  const owns: { c: number; own: Policy; fired: Uint8Array }[] = [];
  for (const c of run.ours) {
    const own = c === car && policy !== null ? policy : (run.fixed[c] ?? NONE);
    const firedOf = c === car ? fired : new Uint8Array(own.triggers.length);
    const ctx: PlayContext = { neutralisations: scenario.neutralisations, lapsTotal: run.start.lapsTotal, weather: entry.weather, wearRateOffPct: entry.wearRateOffPct[c] ?? 0 };
    policies[c] = playOut(own, ctx, firedOf);
    owns.push({ c, own, fired: firedOf });
  }
  if (owns.some((o) => o.own.triggers.some((t) => t.kind === 'rivalPits'))) rivalPits(run, policies, scenario, owns);
  if (run.rules.coverRule) cover(run, policies, entry);
  return policies;
}

/** Car `k`'s first stop from the starting lap on, before the last lap (none: undefined). */
const firstStop = (run: Run, policy: Policy | undefined): Stop | undefined => policy?.stops.find((s) => s.lap >= run.start.lap && s.lap < run.start.lapsTotal);

/** The field at the line ending a lap: per car slot its position (0: not running) and its gap to the leader. */
type Line = { position: ArrayLike<number>; gapMs: ArrayLike<number> };

/** The starting point's field as a line: the running cars in its order, at its gaps. */
function startLine(start: StartingPoint): Line {
  const position = new Int8Array(start.cars);
  let p = 0;
  for (const c of start.order) if (start.retired[c] !== 1) position[c] = ++p;
  return { position, gapMs: start.gapMs };
}

/** Car `c`'s gap to car `k` at `line` (positive: `k` ahead); undefined where either is not running. */
function gapTo(line: Line | undefined, c: number, k: number): number | undefined {
  if (line === undefined || (line.position[c] ?? 0) === 0 || (line.position[k] ?? 0) === 0) return undefined;
  return (line.gapMs[c] ?? 0) - (line.gapMs[k] ?? 0);
}

/**
 * Our cars' `rivalPits` triggers (spec §7.4, S13), on one traced forecast of the policies played out so far. A gap is
 * read at the line before the in-lap in question (the line ending lap r − 1 for a stop at the end of lap r; the starting
 * point's before its first line), so no in-lap's share of a pit loss is in it.
 * - `cover`: the named rival boxes at the end of lap r while within `withinMs` of our car (ahead or behind): our car
 *   boxes at the end of lap r + 1 for its next planned stop's compound in place of that stop (the rival's new compound
 *   without one).
 * - `extend` (high-level spec §3.4): before our next planned stop's in-lap (lap s) the named rival is ahead within
 *   `withinMs` and boxes at the end of lap r ≥ s: our car stays out until it has boxed and rejoined, boxing at the end
 *   of lap r + 1 instead.
 */
function rivalPits(run: Run, policies: Policy[], scenario: Scenario, owns: readonly { c: number; own: Policy; fired: Uint8Array }[]): void {
  const { start } = run;
  let toLap = -1;
  for (const { c, own } of owns) {
    for (const t of own.triggers) {
      if (t.kind !== 'rivalPits') continue;
      const r = firstStop(run, policies[t.carId]);
      if (r !== undefined) toLap = Math.max(toLap, r.lap - 1);
      const s = firstStop(run, policies[c]);
      if (t.action === 'extend' && s !== undefined) toLap = Math.max(toLap, s.lap - 1);
    }
  }
  if (toLap === -1) return;
  const trace = toLap >= start.lap ? (forecast(run, policies, scenario, { trace: true, toLap }).trace ?? []) : [];
  const before = startLine(start);
  const lineBefore = (lap: number): Line | undefined => (lap - 1 < start.lap ? before : trace.find((e) => e.lap === lap - 1));
  for (const { c, own, fired } of owns) {
    own.triggers.forEach((t, i) => {
      if (t.kind !== 'rivalPits') return;
      const k = t.carId as number;
      const r = firstStop(run, policies[k]);
      if (r === undefined || r.lap + 1 >= start.lapsTotal) return;
      const stops = (policies[c]?.stops ?? []).map((s) => ({ lap: s.lap, compound: s.compound }));
      if (t.action === 'cover') {
        const gap = gapTo(lineBefore(r.lap), c, k);
        if (gap === undefined || Math.abs(gap) > t.withinMs) return;
        fired[i] = 1;
        const next = stops.find((s) => s.lap >= r.lap + 1);
        boxAt(stops, r.lap + 1, next?.compound ?? r.compound);
      } else {
        const s = firstStop(run, { stops, triggers: [] });
        if (s === undefined || r.lap < s.lap) return;
        const gap = gapTo(lineBefore(s.lap), c, k);
        if (gap === undefined || gap <= 0 || gap > t.withinMs) return;
        fired[i] = 1;
        s.lap = r.lap + 1;
      }
      stops.sort((a, b) => a.lap - b.lap);
      policies[c] = { stops, triggers: [] };
    });
  }
}

/**
 * The cover rule (spec §7.2 ablation): a rival ahead of our stopping car by at most `COVER_GAP_MS` at the line ending our
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
        if (pos === 0 || pos >= ourPos || (entry.gapMs[c] ?? 0) - (entry.gapMs[k] ?? 0) > COVER_GAP_MS) continue;
        const planned = rivalLaps[k] ?? -1;
        const now = policies[k]?.stops[0]?.lap ?? planned;
        if (now !== -1 && now <= s.lap + 1) continue;
        policies[k] = rivalPlan(start, k, s.lap + 1, weather, scenario.neutralisations, run.rules.reactionLaps);
      }
    }
  }
}
