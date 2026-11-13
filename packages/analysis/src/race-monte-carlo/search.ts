// The search (SP4.3b spec §7.3) and the rows (§7.4): every candidate of our car scored on common scenarios, a first
// batch of `n0` for all, identical candidates merged, further scenarios to those still close to the leader (dropped
// beyond `zDrop` SEs of the paired difference), the top `rescoreTop` scored again together up to a common count. The cap
// is a count of `raceForecast` calls (C2: no clock), shared by our cars and charged per call made (Task 23b); `scoreAll`
// scores every candidate on the same scenarios, nothing merged or dropped.
import { NOISE_COMPOUNDS, type CarId, type McRow, type Policy } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { RESCORE_SHARE } from './constants.ts';
import { paired, rank, ties, type Scored } from './rank.ts';
import { createRun, forecast, policiesIn, scenarioOf, type Run } from './scenarios.ts';
import type { McCandidate, McConfig, McInput, McResult } from './types.ts';

/** One candidate's outcomes over the scenarios it ran (ids `from` + 1 … `from` + n, common to every candidate). */
type Cand = {
  c: McCandidate;
  from: number;
  n: number;
  pos: Float64Array;
  points: Float64Array;
  /** Race time; NaN where the car retired. */
  time: Float64Array;
  /** Per trigger: the scenarios it fired in, and the positions summed over them. */
  fired: Float64Array;
  firedPos: Float64Array;
};

/** The first scenario id of the re-scoring (spec §7.3 step 5): fresh scenarios, none of the search's. */
const FRESH_FROM = 0x40000000;

const newCand = (c: McCandidate, capacity: number, from = 0): Cand => ({
  c,
  from,
  n: 0,
  pos: new Float64Array(capacity),
  points: new Float64Array(capacity),
  time: new Float64Array(capacity),
  fired: new Float64Array(c.policy.triggers.length),
  firedPos: new Float64Array(c.policy.triggers.length),
});

/** Runs candidate `x` of car `car` on its scenarios up to its `to`-th. */
function extend(run: Run, config: McConfig, car: number, x: Cand, to: number): void {
  const fired = new Uint8Array(x.c.policy.triggers.length);
  const cars = run.start.cars;
  for (let i = x.n; i < to; i++) {
    const id = x.from + i + 1;
    const policies = policiesIn(run, id, car, x.c.policy, fired);
    const r = forecast(run, policies, scenarioOf(run, id).scenario);
    const p = r.position[car] ?? 0;
    const pos = p === 0 ? cars : p;
    x.pos[i] = pos;
    x.points[i] = p === 0 ? 0 : (config.points[p - 1] ?? 0);
    x.time[i] = p === 0 ? Number.NaN : (r.raceTimeMs[car] ?? 0);
    for (let t = 0; t < fired.length; t++) {
      if (fired[t] !== 1) continue;
      x.fired[t] = (x.fired[t] ?? 0) + 1;
      x.firedPos[t] = (x.firedPos[t] ?? 0) + pos;
    }
  }
  x.n = Math.max(x.n, to);
}

function mean(a: Float64Array, n: number): number {
  let s = 0;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const v = a[i] ?? 0;
    if (Number.isNaN(v)) continue;
    s += v;
    m++;
  }
  return m === 0 ? Number.NaN : s / m;
}

const scoredOf = (x: Cand): Scored => ({
  pos: x.pos.subarray(0, x.n),
  points: x.points.subarray(0, x.n),
  ePos: mean(x.pos, x.n),
  ePoints: mean(x.points, x.n),
  meanMs: mean(x.time, x.n),
});

/** Whether two candidates gave the same outcome on every scenario both ran (and ran the same). */
function identical(a: Cand, b: Cand): boolean {
  if (a.n !== b.n) return false;
  for (let i = 0; i < a.n; i++) {
    if (a.pos[i] !== b.pos[i]) return false;
    if (!Object.is(a.time[i], b.time[i])) return false;
  }
  return true;
}

/** The car's starting position: its place among the running cars in the starting order. */
function startPosition(run: Run, car: number): number {
  let p = 0;
  for (const c of run.start.order) {
    if (run.start.retired[c] === 1) continue;
    p++;
    if (c === car) return p;
  }
  return run.start.cars;
}

/** Why a committed policy can no longer be followed as committed: a stop lap passed, or no set of a compound left. */
function infeasible(run: Run, car: number, policy: Policy): McRow['infeasible'] {
  if (policy.stops.some((s) => s.lap < run.start.lap)) return 'stopLapPassed';
  const sets = run.start.sets[car as CarId] ?? [];
  for (const compound of NOISE_COMPOUNDS) {
    const needed = policy.stops.filter((s) => s.compound === compound).length;
    if (needed > sets.filter((s) => s.compound === compound).length) return 'noSetLeft';
  }
  return null;
}

const same = (a: Policy | null, b: Policy): boolean => a !== null && JSON.stringify(a) === JSON.stringify(b);

function quantile(pmf: number[], q: number): number {
  let s = 0;
  for (let p = 0; p < pmf.length; p++) {
    s += pmf[p] ?? 0;
    if (s >= q - 1e-12) return p + 1;
  }
  return pmf.length;
}

/**
 * The ranked rows of car `car`'s candidates (spec §7.4), each over its own scenarios (a common prefix). With `ref`
 * (the leader over these scenarios, ranked above them) each row's difference, SE and tie are against it instead.
 */
function rowsOf(run: Run, input: McInput, car: number, cands: readonly Cand[], ref?: Cand): McRow[] {
  const { zTie, tieBand } = input.config;
  const scored = cands.map(scoredOf);
  const ranking = rank(scored, zTie, tieBand);
  if (ref !== undefined) {
    const lead = scoredOf(ref);
    scored.forEach((s, i) => {
      const d = paired(lead.pos, s.pos);
      ranking.diff[i] = d;
      ranking.tie[i] = ties(d, zTie, tieBand);
    });
  }
  const cars = run.start.cars;
  const from = startPosition(run, car);
  const committed = input.committed[car as CarId] ?? null;
  return ranking.order.map((i, index) => {
    const x = cands[i] as Cand;
    const s = scored[i] as Scored;
    const counts = new Array<number>(cars).fill(0);
    let gain = 0;
    for (let k = 0; k < x.n; k++) {
      const p = x.pos[k] ?? cars;
      counts[p - 1] = (counts[p - 1] ?? 0) + 1;
      if (p < from) gain++;
    }
    const positionPmf = counts.map((c) => c / x.n);
    const isCommitted = same(committed, x.c.policy);
    const diff = ranking.diff[i] ?? { mean: 0, se: 0 };
    return {
      policy: x.c.policy,
      source: x.c.source,
      positionPmf,
      ePos: s.ePos,
      ePoints: s.ePoints,
      meanMs: s.meanMs,
      quantiles: { p10: quantile(positionPmf, 0.1), p50: quantile(positionPmf, 0.5), p90: quantile(positionPmf, 0.9) },
      pGain: gain / x.n,
      triggers: x.c.policy.triggers.map((t, k) => {
        const n = x.fired[k] ?? 0;
        // what it was worth: E[position] where it did not fire less E[position] where it fired (0 where either is empty)
        const posFired = x.firedPos[k] ?? 0;
        const posAll = s.ePos * x.n;
        const worthPos = n === 0 || n === x.n ? 0 : (posAll - posFired) / (x.n - n) - posFired / n;
        return { kind: t.kind, fired: n / x.n, worthPos };
      }),
      diff: diff.mean,
      se: diff.se,
      tie: ranking.tie[i] ?? false,
      committed: isCommitted,
      infeasible: isCommitted ? infeasible(run, car, x.c.policy) : null,
      // placeholders until SP4.3b2 Tasks 4 and 6: the rank by place, no deltas, no rule copy
      rank: index + 1,
      deltaLeaderMs: 0,
      deltaPlanMs: null,
      rule: null,
    };
  });
}

/** Our cars with candidates, and the plan each follows while another is scored: committed, else its first candidate. */
function setup(input: McInput, rng: Rng): { run: Run; cars: number[] } {
  const fixed: Record<number, Policy | null> = {};
  for (const key of Object.keys(input.start.sets)) {
    const c = Number(key);
    fixed[c] = input.committed[c as CarId] ?? input.candidates[c as CarId]?.[0]?.policy ?? null;
  }
  const run = createRun(input.start, input.hazard, input.rivalRules, fixed, rng);
  const cars = Object.keys(input.candidates)
    .map(Number)
    .filter((c) => (input.candidates[c as CarId]?.length ?? 0) > 0);
  return { run, cars };
}

export function scoreAll(input: McInput, rng: Rng, scenarios: number): McResult {
  const { run, cars } = setup(input, rng);
  const out: McResult = {};
  for (const car of cars) {
    const cands = (input.candidates[car as CarId] ?? []).map((c) => newCand(c, scenarios));
    for (const x of cands) extend(run, input.config, car, x, scenarios);
    out[car as CarId] = { rows: rowsOf(run, input, car, cands), scenarios, capHit: false, unresolvedTie: false };
  }
  return out;
}

/** Removes from `alive` (and `all`) every candidate identical to an earlier one; a committed one is kept in its place. */
function merge(alive: Cand[], all: Cand[], committed: Policy | null): void {
  const kept: Cand[] = [];
  for (const x of alive) {
    const twin = kept.findIndex((y) => identical(x, y));
    if (twin === -1) {
      kept.push(x);
      continue;
    }
    const y = kept[twin] as Cand;
    const keepX = same(committed, x.c.policy) && !same(committed, y.c.policy);
    kept[twin] = keepX ? x : y;
    all.splice(all.indexOf(keepX ? y : x), 1);
  }
  alive.splice(0, alive.length, ...kept);
}

const hasRivalPits = (p: Policy | null | undefined): boolean => p?.triggers.some((t) => t.kind === 'rivalPits') === true;

/**
 * The most `raceForecast` calls one evaluation of `x` for car `car` takes: the run's (the cover rule's traced run), one
 * more where a `rivalPits` trigger is played (`x`'s or another of our cars' fixed plan: the field's gaps, a traced run).
 * The cap is charged the calls made (Task 23b); this bounds a batch so it never passes the cap.
 */
function costOf(run: Run, car: number, x: Cand): number {
  let rival = hasRivalPits(x.c.policy);
  for (const c of run.ours) if (c !== car && hasRivalPits(run.fixed[c])) rival = true;
  return run.cost + (rival ? 1 : 0);
}

const costSum = (run: Run, car: number, group: readonly Cand[]): number => group.reduce((s, x) => s + costOf(run, car, x), 0);

/** Against the leader `lead`: clearly worse (beyond `zDrop` SEs), clearly within the tie band, or still open. */
function verdict(lead: Scored, x: Scored, zDrop: number, tieBand: number): 'worse' | 'tie' | 'open' {
  const d = paired(lead.pos, x.pos);
  if (d.mean > zDrop * d.se) return 'worse';
  return d.mean + zDrop * d.se < tieBand ? 'tie' : 'open';
}

/** The candidate of `xs` with the least E[position] (the first of equals). */
const leaderOf = (xs: readonly Cand[]): Cand => xs.reduce((best, x) => (scoredOf(x).ePos < scoredOf(best).ePos ? x : best), xs[0] as Cand);

/**
 * Adds batches of `n0` scenarios (fewer at the end) to `group` until `done` holds or `budget` `raceForecast` calls are
 * spent; returns the calls spent and whether the budget stopped it. A batch is as long as its most calls still fit.
 */
function batches(run: Run, input: McInput, car: number, group: Cand[], budget: number, done: () => boolean, after?: () => void): { spent: number; capHit: boolean } {
  const before = run.calls;
  while (!done()) {
    const step = Math.min(input.config.n0, Math.floor((budget - (run.calls - before)) / costSum(run, car, group)));
    if (step < 1) return { spent: run.calls - before, capHit: true };
    const to = (group[0] as Cand).n + step;
    for (const x of group) extend(run, input.config, car, x, to);
    after?.();
  }
  return { spent: run.calls - before, capHit: false };
}

/** Whether every candidate of `group` has its first `n0` scenarios: none is judged before (Task 23b). */
const judgeable = (group: readonly Cand[], n0: number): boolean => group.every((x) => x.n >= n0);

/** The re-scored top (fresh scenarios), the rest (the search's), the re-scored leader's search outcomes. */
type Searched = { top: Cand[]; rest: Cand[]; ref?: Cand | undefined; capHit: boolean; unresolvedTie: boolean };

/**
 * Car `car`'s search within `budget` `raceForecast` calls (spec §7.3): the first batch for all, merged; batches to the
 * candidates still close to the leader until it is clear (the rest kept back for re-scoring, `RESCORE_SHARE`); then the
 * top `rescoreTop` together on fresh common scenarios until their leader is clear, within what is left. No candidate is
 * dropped, tied or settled before it has `n0` scenarios; a first batch under `n0` means the cap stopped the run.
 */
function search(run: Run, input: McInput, car: number, budget: number): Searched {
  const { n0, zDrop, tieBand, zTie, rescoreTop } = input.config;
  const committed = input.committed[car as CarId] ?? null;
  const all = (input.candidates[car as CarId] ?? []).map((c) => newCand(c, Math.max(budget, 1)));
  const before = run.calls;
  const first = Math.min(n0, Math.floor(budget / costSum(run, car, all)));
  if (first === 0) {
    // fewer calls than one scenario each: one scenario each for as many as fit
    const scoredOnes: Cand[] = [];
    let held = 0;
    for (const x of all) {
      held += costOf(run, car, x);
      if (held > budget) break;
      scoredOnes.push(x);
    }
    for (const x of scoredOnes) extend(run, input.config, car, x, 1);
    return { top: [], rest: scoredOnes, capHit: true, unresolvedTie: scoredOnes.length > 1 };
  }
  for (const x of all) extend(run, input.config, car, x, first);
  const spent = (): number => run.calls - before;
  const alive = [...all];
  merge(alive, all, committed);
  // the search: drop the clearly worse, stop once every other is clearly worse or clearly tied
  const clear = (): boolean => {
    if (!judgeable(alive, n0)) return false;
    const lead = scoredOf(leaderOf(alive));
    let open = false;
    for (const x of [...alive]) {
      const v = x === leaderOf(alive) ? 'tie' : verdict(lead, scoredOf(x), zDrop, tieBand);
      if (v === 'worse') alive.splice(alive.indexOf(x), 1);
      else if (v === 'open') open = true;
    }
    return !open;
  };
  const searchBudget = Math.max(0, budget - Math.floor(budget * RESCORE_SHARE) - spent());
  const s = batches(run, input, car, alive, searchBudget, clear, () => merge(alive, all, committed));
  // the re-scoring: the top few together on fresh scenarios, none dropped
  const ranked = rank(all.map(scoredOf), zTie, tieBand).order.map((i) => all[i] as Cand);
  const chosen = ranked.slice(0, rescoreTop);
  const top = chosen.map((x) => newCand(x.c, Math.max(budget - spent(), 1), FRESH_FROM));
  const settled = (): boolean => {
    if (!judgeable(top, n0)) return false;
    if (top.length < 2 || (top[0] as Cand).n === 0) return top.length === 1 && (top[0] as Cand).n >= n0;
    const lead = scoredOf(leaderOf(top));
    return top.every((x) => verdict(lead, scoredOf(x), zDrop, tieBand) !== 'open');
  };
  const r = batches(run, input, car, top, budget - spent(), settled);
  if (r.capHit && top.some((x) => x.n === 0)) {
    // nothing left for re-scoring: the search's own outcomes stand
    return { top: [], rest: all, capHit: true, unresolvedTie: s.capHit || first < n0 };
  }
  const capHit = s.capHit || r.capHit || first < n0;
  const ref = chosen[rank(top.map(scoredOf), zTie, tieBand).order[0] ?? 0];
  return { top, rest: ranked.slice(rescoreTop), ref, capHit, unresolvedTie: capHit && !settled() };
}

export function raceMonteCarlo(input: McInput, rng: Rng, maxScenarioPolicies: number): McResult {
  const { run, cars } = setup(input, rng);
  const out: McResult = {};
  // the cap (calls) shared evenly by our cars: neither car's result depends on how soon the other's search ended
  const budget = Math.floor(Math.max(0, maxScenarioPolicies) / Math.max(1, cars.length));
  cars.forEach((car) => {
    const { top, rest, ref, capHit, unresolvedTie } = search(run, input, car, budget);
    // the rest below the re-scored, against the re-scored leader over the search's scenarios
    const rows = [...rowsOf(run, input, car, top), ...rowsOf(run, input, car, rest, ref)];
    out[car as CarId] = { rows, scenarios: [...top, ...rest].reduce((m, x) => Math.max(m, x.n), 0), capHit, unresolvedTie };
  });
  return out;
}
