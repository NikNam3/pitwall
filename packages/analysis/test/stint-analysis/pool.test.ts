// `stint-analysis`'s pooled estimate per compound (spec 5.1, 4.4): `poolCompound` in `src/stint-analysis/pool.ts`, a pure
// function. Contract the tests assume:
//  - `poolCompound(prior, stints, at)`: `prior` is the compound's current prior `{ nuMsPerLap, nuSdMs, source }` (a
//    `StartPrior`'s fields); `stints` are `degradation`'s stints on the compound (`StintDegradation`'s `nuMsPerLap`,
//    `nuSdMs`, `laps` and `startPrior { nuMsPerLap, nuSdMs }`); it returns `{ nuMsPerLap: Known<number>; nuSdMs:
//    Known<number>; laps: number; source: EstimateSource }`, the `Known`s known at `at`;
//  - information form on `ν`'s marginal: `Iₛ = max(0, 1/σₛ² − 1/σ₀ₛ²)`, `Jₛ = μₛ/σₛ² − ν₀ₛ/σ₀ₛ²` (0 when `Iₛ` is 0),
//    `P = 1/σ₀² + Σ Iₛ`, `ν = (ν₀/σ₀² + Σ Jₛ) / P`, sd `√(1/P)`, the session's share `Σ Iₛ / P`;
//  - `laps`: the laps the stints' filters read (`used` and `downWeighted`), over the stints whose `ν` is known;
//  - the source: `session` when the share is above half (4.4), else the prior's kind with its fields; `sessionShare` the
//    share; `parts` `"<n> laps + <the prior's source>"`, the prior's source being a calibration's set name (`41 laps +
//    league`) or a default's own parts (`14 laps + track default`). With no stint: the prior's source as it is, `laps` 0.
import { known, toSessionTime, unknown, type EstimateSource, type LapUse } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { poolCompound } from '../../src/stint-analysis/pool.ts';

const AT = toSessionTime(1_800_000);
const k = (v: number) => known(v, AT);

const LEAGUE: EstimateSource = { kind: 'calibration', setName: 'league', sources: 3, sessionShare: 0, parts: 'calibration' };
const TRACK_DEFAULT: EstimateSource = { kind: 'default', note: 'Silverstone track file (pitwall estimate)', sessionShare: 0, parts: 'track default' };

type Prior = { nuMsPerLap: number; nuSdMs: number; source: EstimateSource };
const prior = (nuMsPerLap: number, nuSdMs: number, source: EstimateSource = LEAGUE): Prior => ({ nuMsPerLap, nuSdMs, source });

/** `n` laps the filter read (`used`, the last `downWeighted` when `n` > 1), then an excluded out lap the count leaves out. */
const lapsOf = (n: number): { lapNumber: number; tyreAge: number; lapTimeMs: number; correctedMs: ReturnType<typeof k>; use: LapUse }[] => [
  { lapNumber: 1, tyreAge: 1, lapTimeMs: 93_000, correctedMs: k(90_000), use: { excluded: 'outLap' } },
  ...Array.from({ length: n }, (_, i) => ({
    lapNumber: i + 2,
    tyreAge: i + 2,
    lapTimeMs: 91_000,
    correctedMs: k(88_000),
    use: (i === n - 1 && n > 1 ? 'downWeighted' : 'used') as LapUse,
  })),
];

/** A stint whose posterior is `(mu, sd)`, started from `(nu0, sd0)`, with `laps` read laps. */
const stint = (mu: number, sd: number, start: { nuMsPerLap: number; nuSdMs: number }, laps: number) => ({
  nuMsPerLap: k(mu),
  nuSdMs: k(sd),
  startPrior: { ...start, alphaOffsetMs: unknown('notApplicable'), source: LEAGUE },
  laps: lapsOf(laps),
});

const value = (x: { known: true; value: number } | { known: false }): number => {
  if (!x.known) throw new Error('unknown');
  return x.value;
};

describe('poolCompound', () => {
  it('no stint of ours: the prior, laps 0, its source', () => {
    const out = poolCompound(prior(60, 60, TRACK_DEFAULT), [], AT);
    expect(out.nuMsPerLap).toEqual(known(60, AT));
    expect(out.nuSdMs).toEqual(known(60, AT));
    expect(out.laps).toBe(0);
    expect(out.source).toEqual(TRACK_DEFAULT);
  });

  it('one stint: information form equals the stint`s posterior when it started from the current prior', () => {
    // prior ν₀ 60, σ₀ 60 (var 3600); posterior μ 80, σ 30 (var 900).
    // I = 1/900 − 1/3600 = 3/3600; J = 80/900 − 60/3600 = 260/3600; P = 1/3600 + 3/3600 = 4/3600 = 1/900.
    // ν = (60/3600 + 260/3600) / (4/3600) = 320/4 = 80; sd = √900 = 30: the posterior. Share 3/4.
    const p = prior(60, 60);
    const out = poolCompound(p, [stint(80, 30, p, 9)], AT);
    expect(value(out.nuMsPerLap)).toBeCloseTo(80, 9);
    expect(value(out.nuSdMs)).toBeCloseTo(30, 9);
    expect(out.laps).toBe(9);
    expect(out.source.sessionShare).toBeCloseTo(0.75, 9);
  });

  it('two stints of our two cars pool their data information', () => {
    // prior ν₀ 60, σ₀ 60. In units of 1/14400: the prior's precision 4, its ν₀/σ₀² 240.
    // stint A (player): μ 80, σ 30 from the prior: I = 1/900 − 1/3600 = 12; J = 80/900 − 60/3600 = 1040.
    // stint B (teammate): μ 100, σ 40 from the prior: I = 1/1600 − 1/3600 = 9 − 4 = 5; J = 100/1600 − 60/3600 = 900 − 240 = 660.
    // P = 4 + 12 + 5 = 21; ν = (240 + 1040 + 660) / 21 = 1940/21 ≈ 92.381; sd = √(14400/21) ≈ 26.186; share 17/21 ≈ 0.810.
    const p = prior(60, 60);
    const out = poolCompound(p, [stint(80, 30, p, 12), stint(100, 40, p, 8)], AT);
    expect(value(out.nuMsPerLap)).toBeCloseTo(1940 / 21, 6);
    expect(value(out.nuSdMs)).toBeCloseTo(Math.sqrt(14400 / 21), 6);
    expect(out.laps).toBe(20);
    expect(out.source.sessionShare).toBeCloseTo(17 / 21, 9);
  });

  it('a stint whose ν is unknown adds nothing', () => {
    const p = prior(60, 60);
    const a = stint(80, 30, p, 12);
    const blind = { ...stint(0, 0, p, 3), nuMsPerLap: unknown('insufficientData'), nuSdMs: unknown('insufficientData') };
    expect(poolCompound(p, [a, blind], AT)).toEqual(poolCompound(p, [a], AT));
  });

  it('a stint that started from another prior (a pick mid-session) contributes only its own data information', () => {
    // current prior ν₀ 60, σ₀ 60 (var 3600); the stint started from ν₀ₛ 40, σ₀ₛ 20 (var 400), posterior μ 50, σ 16 (var 256).
    // I = 1/256 − 1/400 = 144/102400 = 0.00140625; J = 50/256 − 40/400 = 0.1953125 − 0.1 = 0.0953125.
    // P = 1/3600 + 0.00140625; ν = (60/3600 + 0.0953125) / P ≈ 66.495; sd = √(1/P) ≈ 24.368; share 0.00140625 / P ≈ 0.835.
    const p = prior(60, 60);
    const out = poolCompound(p, [stint(50, 16, { nuMsPerLap: 40, nuSdMs: 20 }, 10)], AT);
    const P = 1 / 3600 + 0.00140625;
    expect(value(out.nuMsPerLap)).toBeCloseTo((60 / 3600 + 0.0953125) / P, 6);
    expect(value(out.nuMsPerLap)).toBeCloseTo(66.495, 2);
    expect(value(out.nuSdMs)).toBeCloseTo(Math.sqrt(1 / P), 6);
    expect(out.source.sessionShare).toBeCloseTo(0.00140625 / P, 9);
    // not the stint's posterior, nor the posterior pooled as if it were data on top of the current prior
    expect(value(out.nuMsPerLap)).not.toBeCloseTo(50, 0);
  });

  it('the session`s share above half gives source session', () => {
    // above half (the one-stint case, share 3/4): session, with the used laps and the prior's set name
    const p = prior(60, 60);
    expect(poolCompound(p, [stint(80, 30, p, 41)], AT).source).toEqual({ kind: 'session', sessionShare: expect.closeTo(0.75, 9), parts: '41 laps + league' });
    // below half: prior ν₀ 60, σ₀ 20 (var 400), posterior σ 18 (var 324): I = 1/324 − 1/400 = 76/129600; share
    // I / (1/400 + I) = 76 / (324 + 76) = 0.19: the prior's kind, its set and sources kept
    const q = prior(60, 20);
    expect(poolCompound(q, [stint(62, 18, q, 8)], AT).source).toEqual({
      kind: 'calibration',
      setName: 'league',
      sources: 3,
      sessionShare: expect.closeTo(0.19, 9),
      parts: '8 laps + league',
    });
    // a default prior below half stays default with its note; its parts name the default
    const d = prior(60, 20, TRACK_DEFAULT);
    expect(poolCompound(d, [stint(62, 18, d, 14)], AT).source).toEqual({
      kind: 'default',
      note: 'Silverstone track file (pitwall estimate)',
      sessionShare: expect.closeTo(0.19, 9),
      parts: '14 laps + track default',
    });
  });

  it('I is clipped at 0', () => {
    // posterior σ 70 wider than its start's σ₀ₛ 60 (process noise): 1/4900 − 1/3600 < 0, so I = 0 and J = 0: the prior
    const p = prior(60, 60);
    const out = poolCompound(p, [stint(95, 70, p, 6)], AT);
    expect(value(out.nuMsPerLap)).toBeCloseTo(60, 9);
    expect(value(out.nuSdMs)).toBeCloseTo(60, 9);
    expect(out.source.sessionShare).toBe(0);
    expect(out.source.kind).toBe('calibration');
  });
});
