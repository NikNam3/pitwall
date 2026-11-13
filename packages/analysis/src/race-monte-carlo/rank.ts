// The ranking (SP4.3b spec §7.3, S5 as revised by S25; research 14 proposal 1): by E[position]; a policy ties with the
// leader when its paired difference lies below max(tieBand, zTie × SE); tied policies by E[points] under the same test
// against their leader; then by mean race time. Paired over common scenarios (the prefix both ran).

/** The mean and SE (sample SD, n − 1, over √n) of b − a per scenario, over the scenarios both ran. */
export function paired(a: ArrayLike<number>, b: ArrayLike<number>): { mean: number; se: number } {
  const n = Math.min(a.length, b.length);
  if (n === 0) return { mean: 0, se: 0 };
  let s = 0;
  for (let i = 0; i < n; i++) s += (b[i] ?? 0) - (a[i] ?? 0);
  const mean = s / n;
  if (n === 1) return { mean, se: 0 };
  let v = 0;
  for (let i = 0; i < n; i++) v += ((b[i] ?? 0) - (a[i] ?? 0) - mean) ** 2;
  return { mean: mean + 0, se: Math.sqrt(v / (n - 1)) / Math.sqrt(n) };
}

/** Whether a paired difference is a tie: below max(tieBand, zTie × SE). */
export const ties = (diff: { mean: number; se: number }, zTie: number, tieBand: number): boolean => Math.abs(diff.mean) < Math.max(tieBand, zTie * diff.se);

/** One candidate's per-scenario outcome as the ranking reads it (each over its scenarios run, a common prefix). */
export type Scored = { pos: Float64Array; points: Float64Array; ePos: number; ePoints: number; meanMs: number };

/** A ranking: the candidates' indices best first, and per index its paired E[position] difference against the leader. */
export type Ranking = { order: number[]; diff: { mean: number; se: number }[]; tie: boolean[] };

export function rank(scored: readonly Scored[], zTie: number, tieBand: number): Ranking {
  const idx = scored.map((_, i) => i);
  if (idx.length === 0) return { order: [], diff: [], tie: [] };
  const byPos = [...idx].sort((a, b) => (scored[a]?.ePos ?? 0) - (scored[b]?.ePos ?? 0) || a - b);
  const leader = byPos[0] ?? 0;
  const lead = scored[leader] as Scored;
  const tiedPos = byPos.filter((i) => i === leader || ties(paired(lead.pos, (scored[i] as Scored).pos), zTie, tieBand));
  const rest = byPos.filter((i) => !tiedPos.includes(i));
  // among the tied: by E[points], the points leader's ties by mean race time
  const byPoints = [...tiedPos].sort((a, b) => (scored[b]?.ePoints ?? 0) - (scored[a]?.ePoints ?? 0) || a - b);
  const pointsLeader = scored[byPoints[0] ?? leader] as Scored;
  const tiedPoints = byPoints.filter((i) => ties(paired(pointsLeader.points, (scored[i] as Scored).points), zTie, tieBand));
  tiedPoints.sort((a, b) => (scored[a]?.meanMs ?? 0) - (scored[b]?.meanMs ?? 0) || a - b);
  const order = [...tiedPoints, ...byPoints.filter((i) => !tiedPoints.includes(i)), ...rest];
  const top = scored[order[0] ?? leader] as Scored;
  const diff: { mean: number; se: number }[] = [];
  const tie: boolean[] = [];
  for (const i of idx) {
    diff[i] = i === order[0] ? { mean: 0, se: 0 } : paired(top.pos, (scored[i] as Scored).pos);
    tie[i] = tiedPos.length > 1 && tiedPos.includes(i);
  }
  return { order, diff, tie };
}
