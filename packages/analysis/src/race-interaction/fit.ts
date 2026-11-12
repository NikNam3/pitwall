// The pass curve's fit (SP4.3a spec 5.4): a prior curve refined by following episodes with shrinkage.
//  - Each zone is one Bernoulli outcome with p = cap · σ(level + slopePerMs · advantageMs), × wetFactor when wet. A DRS
//    zone is left out: its pass factor is the config's (spec 8), not the curve's.
//  - The prior weighs as `shrinkEpisodes` episodes: each zone also carries a soft outcome of weight
//    `shrinkEpisodes / episodes`, the prior curve's own p there, so the fit is the prior without episodes, moves to this
//    data's maximum likelihood as episodes come in, and is that maximum with `shrinkEpisodes` 0.
//  - Fisher scoring on (level, slope per second) with step halving; a tiny ridge towards the prior keeps the optimum unique
//    when every zone has the same advantage. Deterministic: a fixed iteration bound, no randomness (C2).
import type { PassCurve } from '@pitwall/domain';
import type { FollowingEpisode } from './episodes.ts';

/** The ridge towards the prior (per unit of level and of slope per second): small against any one zone's information. */
const RIDGE = 1e-6;
const MAX_ITERATIONS = 100;
const MAX_HALVINGS = 40;
const TOLERANCE = 1e-12;

type Obs = { u: number; k: number; y: number; p0: number };

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** `prior` refined by `episodes`, the prior weighing as `shrinkEpisodes` episodes; its cap and wet factor stay the prior's. */
export function fitPassCurve(episodes: readonly FollowingEpisode[], prior: PassCurve, shrinkEpisodes: number): PassCurve {
  const level0 = prior.level;
  const slope0 = prior.slopePerMs * 1_000;
  const cap = prior.cap;
  const obs: Obs[] = [];
  for (const episode of episodes) {
    for (const zone of episode.zones) {
      if (zone.drs) continue;
      const u = zone.advantageMs / 1_000;
      const k = zone.wet ? prior.wetFactor : 1;
      obs.push({ u, k, y: zone.passed ? 1 : 0, p0: k * cap * sigmoid(level0 + slope0 * u) });
    }
  }
  if (obs.length === 0 || cap <= 0) return { ...prior };
  const w = shrinkEpisodes / episodes.length;

  const objective = (level: number, slope: number): number => {
    let sum = -(RIDGE / 2) * ((level - level0) ** 2 + (slope - slope0) ** 2);
    for (const o of obs) {
      const p = o.k * cap * sigmoid(level + slope * o.u);
      const a = o.y + w * o.p0;
      const b = 1 - o.y + w * (1 - o.p0);
      sum += (a > 0 ? a * Math.log(p) : 0) + (b > 0 ? b * Math.log(1 - p) : 0);
    }
    return sum;
  };

  let level = level0;
  let slope = slope0;
  let current = objective(level, slope);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let g0 = RIDGE * (level0 - level);
    let g1 = RIDGE * (slope0 - slope);
    let h00 = RIDGE;
    let h01 = 0;
    let h11 = RIDGE;
    for (const o of obs) {
      const s = sigmoid(level + slope * o.u);
      const p = o.k * cap * s;
      const dp = o.k * cap * s * (1 - s);
      const a = o.y + w * o.p0;
      const b = 1 - o.y + w * (1 - o.p0);
      const score = (a / p - b / (1 - p)) * dp;
      const info = ((a + b) * dp * dp) / (p * (1 - p));
      g0 += score;
      g1 += score * o.u;
      h00 += info;
      h01 += info * o.u;
      h11 += info * o.u * o.u;
    }
    const det = h00 * h11 - h01 * h01;
    if (!(det > 0)) break;
    let dl = (h11 * g0 - h01 * g1) / det;
    let ds = (h00 * g1 - h01 * g0) / det;
    let next = objective(level + dl, slope + ds);
    for (let halving = 0; !(next >= current) && halving < MAX_HALVINGS; halving++) {
      dl /= 2;
      ds /= 2;
      next = objective(level + dl, slope + ds);
    }
    if (!(next >= current)) break;
    level += dl;
    slope += ds;
    current = next;
    if (Math.abs(dl) + Math.abs(ds) < TOLERANCE) break;
  }
  return { level, slopePerMs: slope / 1_000, cap, wetFactor: prior.wetFactor };
}
