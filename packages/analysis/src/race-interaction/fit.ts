// The pass curve's fit (SP4.3a spec 5.4; SP4.3b Task 10): a prior curve refined by following episodes with shrinkage.
//  - Each zone is one Bernoulli outcome with p = cap · σ(level + slopePerMs · advantageMs + drsFactor · [DRS]),
//    × wetFactor when wet: a zone with DRS shifts the log-odds by the curve's `drsFactor`.
//  - The prior weighs as `shrinkEpisodes` episodes: each zone also carries a soft outcome of weight
//    `shrinkEpisodes / episodes`, the prior curve's own p there, so the fit is the prior without episodes, moves to this
//    data's maximum likelihood as episodes come in, and is that maximum with `shrinkEpisodes` 0. Without a DRS zone in
//    the data the DRS factor is the prior's.
//  - Fisher scoring on (level, slope per second, DRS factor) with step halving; a tiny ridge towards the prior keeps the
//    optimum unique when the data do not separate the parameters. Deterministic: a fixed iteration bound, no randomness (C2).
import type { PassCurve } from '@pitwall/domain';
import type { FollowingEpisode } from './episodes.ts';

/** The ridge towards the prior (per unit of level, of slope per second and of DRS factor): small against any one zone's information. */
const RIDGE = 1e-6;
const MAX_ITERATIONS = 100;
const MAX_HALVINGS = 40;
const TOLERANCE = 1e-12;

type Obs = { u: number; d: number; k: number; y: number; p0: number };
type Params = readonly [number, number, number];

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** The symmetric 3×3 matrix `[[a, b, c], [b, d, e], [c, e, f]]`. */
type Sym3 = { a: number; b: number; c: number; d: number; e: number; f: number };

/** The solution of `h · x = g` by Cramer's rule, or undefined when `h`'s determinant is not positive. */
function solve3(h: Sym3, g: Params): Params | undefined {
  const { a, b, c, d, e, f } = h;
  const [g0, g1, g2] = g;
  const det = a * (d * f - e * e) - b * (b * f - e * c) + c * (b * e - d * c);
  if (!(det > 0)) return undefined;
  const x0 = (g0 * (d * f - e * e) - b * (g1 * f - e * g2) + c * (g1 * e - d * g2)) / det;
  const x1 = (a * (g1 * f - e * g2) - g0 * (b * f - e * c) + c * (b * g2 - g1 * c)) / det;
  const x2 = (a * (d * g2 - g1 * e) - b * (b * g2 - g1 * c) + g0 * (b * e - d * c)) / det;
  return [x0, x1, x2];
}

/** `prior` refined by `episodes`, the prior weighing as `shrinkEpisodes` episodes; its cap and wet factor stay the prior's. */
export function fitPassCurve(episodes: readonly FollowingEpisode[], prior: PassCurve, shrinkEpisodes: number): PassCurve {
  const p0: Params = [prior.level, prior.slopePerMs * 1_000, prior.drsFactor];
  const cap = prior.cap;
  const eta = (x: Params, o: Obs): number => x[0] + x[1] * o.u + x[2] * o.d;
  const obs: Obs[] = [];
  for (const episode of episodes) {
    for (const zone of episode.zones) {
      const o = { u: zone.advantageMs / 1_000, d: zone.drs ? 1 : 0, k: zone.wet ? prior.wetFactor : 1, y: zone.passed ? 1 : 0, p0: 0 };
      obs.push({ ...o, p0: o.k * cap * sigmoid(eta(p0, o)) });
    }
  }
  if (obs.length === 0 || cap <= 0) return { ...prior };
  const w = shrinkEpisodes / episodes.length;

  const objective = (x: Params): number => {
    let sum = -(RIDGE / 2) * ((x[0] - p0[0]) ** 2 + (x[1] - p0[1]) ** 2 + (x[2] - p0[2]) ** 2);
    for (const o of obs) {
      const p = o.k * cap * sigmoid(eta(x, o));
      const a = o.y + w * o.p0;
      const b = 1 - o.y + w * (1 - o.p0);
      sum += (a > 0 ? a * Math.log(p) : 0) + (b > 0 ? b * Math.log(1 - p) : 0);
    }
    return sum;
  };

  let x: Params = p0;
  let current = objective(x);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let g0 = RIDGE * (p0[0] - x[0]);
    let g1 = RIDGE * (p0[1] - x[1]);
    let g2 = RIDGE * (p0[2] - x[2]);
    const h: Sym3 = { a: RIDGE, b: 0, c: 0, d: RIDGE, e: 0, f: RIDGE };
    for (const o of obs) {
      const s = sigmoid(eta(x, o));
      const p = o.k * cap * s;
      const dp = o.k * cap * s * (1 - s);
      const a = o.y + w * o.p0;
      const b = 1 - o.y + w * (1 - o.p0);
      const score = (a / p - b / (1 - p)) * dp;
      const info = ((a + b) * dp * dp) / (p * (1 - p));
      g0 += score;
      g1 += score * o.u;
      g2 += score * o.d;
      h.a += info;
      h.b += info * o.u;
      h.c += info * o.d;
      h.d += info * o.u * o.u;
      h.e += info * o.u * o.d;
      h.f += info * o.d * o.d;
    }
    let step = solve3(h, [g0, g1, g2]);
    if (step === undefined) break;
    let next = objective([x[0] + step[0], x[1] + step[1], x[2] + step[2]]);
    for (let halving = 0; !(next >= current) && halving < MAX_HALVINGS; halving++) {
      step = [step[0] / 2, step[1] / 2, step[2] / 2];
      next = objective([x[0] + step[0], x[1] + step[1], x[2] + step[2]]);
    }
    if (!(next >= current)) break;
    x = [x[0] + step[0], x[1] + step[1], x[2] + step[2]];
    current = next;
    if (Math.abs(step[0]) + Math.abs(step[1]) + Math.abs(step[2]) < TOLERANCE) break;
  }
  return { level: x[0], slopePerMs: x[1] / 1_000, cap, wetFactor: prior.wetFactor, drsFactor: x[2] };
}
