// `race-monte-carlo` (SP4.3b spec §7, Task 19; C2, C3, C50): candidate policies of our cars scored over common random
// scenarios drawn through `race-forecast`, searched under a scenario-policy cap. Starting points are built by hand
// (`../race-forecast/start.ts`); how these tests read the inputs and outputs is stated in `support.ts`.
import type { Policy, StartingPoint, Trigger } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import * as mc from '../../src/race-monte-carlo/index.ts';
import { fieldPositions, raceMonteCarlo, scoreAll, SIMULATOR, type FieldInput } from '../../src/race-monte-carlo/index.ts';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { drawn, interaction, NOISY, PLAIN, startingPoint, type CarSpec } from '../race-forecast/start.ts';
import { byCar, candidate, carOf, hazard, mcInput, NO_STOP, pmfOf, RIVAL_RULES, rowOf, rowsOf, shareSe, stopAt, type Row } from './support.ts';

/** The standard normal CDF (Abramowitz and Stegun 7.1.26, error below 1.5e-7). */
function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** A function the unit exports that the stubs of Task 3 do not declare yet (preconditions 4–5 of the 4.3b2 plan). */
function exported<F>(name: string): F {
  const f = (mc as Record<string, unknown>)[name];
  if (typeof f !== 'function') throw new Error(`race-monte-carlo/index.ts exports no ${name}`);
  return f as F;
}

const box = (condition: 'sc' | 'vsc', lap: number): Trigger => ({ kind: 'neutralised', condition, fromLap: lap, toLap: lap, action: { box: 'hard' } });

/** Two cars on the line together, only their pace levels drawn; every pass at the next braking zone is certain. */
function paceDuel(): { start: StartingPoint; pAhead: number } {
  const cars: CarSpec[] = [
    { gapMs: 0, paceMs: 90_000, paceSdMs: 100 },
    { gapMs: 0, paceMs: 90_100, paceSdMs: 200 },
  ];
  const brakingZones = Array.from({ length: 20 }, (_, i) => (i + 0.5) / 20);
  const start = startingPoint({ lapsTotal: 5, cars, ours: [0], brakingZones, interaction: interaction({ minGapMs: 0, drsStraightGainMs: 0, curve: { level: 30, slopePerMs: 0, cap: 1 } }) });
  // P(car 0 ahead) = P(its pace level below car 1's)
  const pAhead = phi((90_100 - 90_000) / Math.sqrt(100 ** 2 + 200 ** 2));
  return { start, pAhead };
}

/** A six-car field with the AI field's noise and no retirements; our cars `ours` (default slot 2). */
function noisyField(o: { ours?: number[]; lapsTotal?: number } = {}): StartingPoint {
  const cars: CarSpec[] = Array.from({ length: 6 }, (_, i) => ({ ...NOISY, retireRate: 0, gapMs: 1_500 * i, paceMs: 90_000 + 60 * i }));
  return startingPoint({ lapsTotal: o.lapsTotal ?? 6, cars, ours: o.ours ?? [2] });
}

describe('race-monte-carlo: the simulator marker', () => {
  it("exports SIMULATOR = defineSimulator('race-monte-carlo')", () => {
    expect(SIMULATOR).toEqual({ kind: 'simulator', name: 'race-monte-carlo' });
  });
});

describe('race-monte-carlo: scenarios (spec §7.1)', () => {
  // row 1
  it("SC counts and start laps match race-hazard's table within 3 SE", () => {
    // one car alone, quiet: its race time moves only with the neutralisations; SC on laps 3 and 9, a VSC on lap 7
    const start = startingPoint({ lapsTotal: 10, cars: [{}], ours: [0] });
    const p = { sc3: 0.3, vsc7: 0.25, sc9: 0.2 };
    const hz = hazard(10, { sc: { 2: p.sc3, 8: p.sc9 }, vsc: { 6: p.vsc7 } });
    const watched: Policy = { stops: [], triggers: [box('sc', 3), box('sc', 5), box('vsc', 7), box('sc', 9)] };
    const n = 5_000;
    const rows = carOf(scoreAll(mcInput(start, { 0: [NO_STOP, watched] }, { hazard: hz }), createRng(7), n), 0).rows;

    // start laps: each trigger fires when its neutralisation is out on its lap
    const fired = rowOf(rows, watched).triggers;
    expect(fired).toHaveLength(4);
    expect(Math.abs(fired[0]!.fired - p.sc3)).toBeLessThanOrEqual(3 * shareSe(p.sc3, n));
    expect(fired[1]!.fired).toBe(0);
    expect(Math.abs(fired[2]!.fired - p.vsc7)).toBeLessThanOrEqual(3 * shareSe(p.vsc7, n));
    expect(Math.abs(fired[3]!.fired - p.sc9)).toBeLessThanOrEqual(3 * shareSe(p.sc9, n));

    // counts: the mean race time is the green one plus each neutralisation's cost times its chance
    const time = (ns: { kind: 'sc' | 'vsc'; fromLap: number; toLap: number }[]): number => raceForecast(start, [NO_STOP], drawn(1, ns), createRng(1)).raceTimeMs[0]!;
    const green = time([]);
    const cost = {
      sc3: time([{ kind: 'sc', fromLap: 3, toLap: 3 }]) - green,
      vsc7: time([{ kind: 'vsc', fromLap: 7, toLap: 7 }]) - green,
      sc9: time([{ kind: 'sc', fromLap: 9, toLap: 9 }]) - green,
    };
    const mean = green + p.sc3 * cost.sc3 + p.vsc7 * cost.vsc7 + p.sc9 * cost.sc9;
    const variance = cost.sc3 ** 2 * p.sc3 * (1 - p.sc3) + cost.vsc7 ** 2 * p.vsc7 * (1 - p.vsc7) + cost.sc9 ** 2 * p.sc9 * (1 - p.sc9);
    expect(Math.abs(rowOf(rows, NO_STOP).meanMs - mean)).toBeLessThanOrEqual(3 * Math.sqrt(variance / n));
  });

  // row 2
  it('two cars with known spreads give the analytic chance of finishing ahead', () => {
    const { start, pAhead } = paceDuel();
    const n = 4_000;
    const row = carOf(scoreAll(mcInput(start, { 0: [NO_STOP] }), createRng(3), n), 0).rows[0]!;
    expect(Math.abs(row.positionPmf[0]! - pAhead)).toBeLessThanOrEqual(3 * shareSe(pAhead, n));
    expect(row.positionPmf[0]! + row.positionPmf[1]!).toBeCloseTo(1, 9);
  });

  // row 3
  it('the E[pos] error falls as 1/√N', () => {
    const { start, pAhead } = paceDuel();
    const truth = 2 - pAhead;
    const sd = Math.sqrt(pAhead * (1 - pAhead));
    const seeds = 16;
    const rms = (n: number): number => {
      let s = 0;
      for (let seed = 1; seed <= seeds; seed++) s += (carOf(scoreAll(mcInput(start, { 0: [NO_STOP] }), createRng(1_000 * n + seed), n), 0).rows[0]!.ePos - truth) ** 2;
      return Math.sqrt(s / seeds);
    };
    const errors = [250, 1_000, 4_000].map((n) => ({ n, rms: rms(n) }));
    for (const { n, rms: e } of errors) {
      // the error times √N over the position's SD: 1, within the spread of 16 seeds' RMS
      const ratio = (e * Math.sqrt(n)) / sd;
      expect(ratio).toBeGreaterThan(0.55);
      expect(ratio).toBeLessThan(1.6);
    }
    expect(errors[0]!.rms).toBeGreaterThan(2 * errors[2]!.rms);
  });

  // row 4
  it('a committed policy is followed in every scenario', () => {
    // our cars 0 and 1 (30 s apart), a rival far behind; quiet, an SC on lap 3 in every scenario
    const start = startingPoint({ lapsTotal: 8, cars: [{ gapMs: 0 }, { gapMs: 30_000 }, { gapMs: 60_000 }], ours: [0, 1] });
    const committed = stopAt(2, 'hard');
    const sc = hazard(8, { sc: { 2: 1 } });
    const input = mcInput(start, { 0: [NO_STOP], 1: [candidate(committed, 'committed'), candidate(NO_STOP, 'dp')] }, { hazard: sc, committed: { 1: committed } });
    const result = raceMonteCarlo(input, createRng(9), 5_000);

    const marked = carOf(result, 1).rows.filter((r) => r.committed);
    expect(marked).toHaveLength(1);
    const row = marked[0]!;
    expect(row.policy).toEqual(committed);
    expect(row.source).toBe('committed');
    expect(row.infeasible).toBeNull();
    // every scenario is the one forecast of the committed policy under the SC: its time and a point mass on its place
    const forecast = raceForecast(start, [NO_STOP, committed, NO_STOP], drawn(1, [{ kind: 'sc', fromLap: 3, toLap: 3 }]), createRng(1));
    expect(Math.abs(row.meanMs - forecast.raceTimeMs[1]!)).toBeLessThanOrEqual(1e-6);
    expect(row.positionPmf[forecast.position[1]! - 1]).toBe(1);
    // the teammate is scored against it as certain input
    expect(Math.abs(rowOf(carOf(result, 0).rows, NO_STOP).meanMs - forecast.raceTimeMs[0]!)).toBeLessThanOrEqual(1e-6);
  });

  // row 5
  it('one more stop of one candidate leaves every other draw unchanged', () => {
    const start = noisyField({ lapsTotal: 8 });
    const a = stopAt(3, 'hard');
    const aMore: Policy = { stops: [{ lap: 3, compound: 'hard' }, { lap: 6, compound: 'medium' }], triggers: [] };
    const b = stopAt(4, 'medium');
    const hz = hazard(8, { sc: { 3: 0.2, 5: 0.1 }, vsc: { 4: 0.1 }, scDur: [0.5, 0.5] });
    const before = carOf(scoreAll(mcInput(start, { 2: [a, b] }, { hazard: hz }), createRng(21), 400), 2).rows;
    const after = carOf(scoreAll(mcInput(start, { 2: [aMore, b] }, { hazard: hz }), createRng(21), 400), 2).rows;
    const outcome = (r: Row) => ({ positionPmf: r.positionPmf, ePos: r.ePos, ePoints: r.ePoints, meanMs: r.meanMs, quantiles: r.quantiles, pGain: r.pGain, triggers: r.triggers });
    expect(outcome(rowOf(after, b))).toStrictEqual(outcome(rowOf(before, b)));
  });

  // row 6
  it("the plain forecast's finishing order is one mode of the distribution", () => {
    const start = noisyField({ lapsTotal: 8 });
    const n = 2_000;
    const plain = raceForecast(start, Array.from({ length: 6 }, () => NO_STOP), PLAIN, createRng(1));
    const row = carOf(scoreAll(mcInput(start, { 2: [NO_STOP] }), createRng(4), n), 2).rows[0]!;
    const top = Math.max(...row.positionPmf);
    expect(row.positionPmf[plain.position[2]! - 1]!).toBeGreaterThanOrEqual(top - 3 * shareSe(top, n));
  });
});

describe('race-monte-carlo: the search and the rivals (spec §7.2, §7.3)', () => {
  // row 7
  it('candidates identical on every scenario are merged', () => {
    const start = noisyField();
    // no neutralisation is ever drawn, so the trigger never fires: the same outcome as no trigger, in every scenario
    const never: Policy = { stops: [], triggers: [{ kind: 'neutralised', condition: 'sc', fromLap: 2, toLap: 6, action: { box: 'hard' } }] };
    const rows = carOf(raceMonteCarlo(mcInput(start, { 2: [NO_STOP, never, stopAt(3, 'hard')] }), createRng(13), 5_000), 2).rows;
    expect(rowsOf(rows, NO_STOP).length + rowsOf(rows, never).length).toBe(1);
  });

  // row 9
  it('rivals: under SC a car owing a stop with age ≥ aMin boxes with chance q; under VSC never', () => {
    // the rival (slot 0) leads our car (slot 1) by 2 s; a stop's loss is paid before the line (in-lap share 1)
    const rivalAt = (o: { tyreAge: number; owes: 0 | 1; window: [number, number, number] }): StartingPoint => {
      const start = startingPoint({ lapsTotal: 10, cars: [{ gapMs: 0, tyreAge: o.tyreAge }, { gapMs: 2_000 }], ours: [1], pitLossMs: { green: 22_000, vsc: 13_000, sc: 11_000, inLapShare: 1 } });
      [start.stopLow[0], start.stopMid[0], start.stopHigh[0]] = o.window;
      start.owesStop[0] = o.owes;
      return start;
    };
    const n = 2_000;
    // P(the rival behind our car at the line ending lap 4): it boxed under the neutralisation out on laps 2–3
    const boxed = (start: StartingPoint, condition: 'sc' | 'vsc'): number => {
      const hz = condition === 'sc' ? hazard(10, { sc: { 1: 1 }, scDur: [0, 1] }) : hazard(10, { vsc: { 1: 1 }, vscDur: [0, 1] });
      const input: FieldInput = { start, plans: byCar({ 1: NO_STOP }), hazard: hz, rivalRules: RIVAL_RULES, scenarios: n, laps: [4] };
      return pmfOf(fieldPositions(input, createRng(17)), 0)[0]![1]!;
    };
    const q = RIVAL_RULES.q;
    const owes = rivalAt({ tyreAge: 10, owes: 1, window: [6, 7, 8] });
    expect(Math.abs(boxed(owes, 'sc') - q)).toBeLessThanOrEqual(3 * shareSe(q, n));
    // a stop still ahead in its window, though the compound rule demands none (R23)
    expect(Math.abs(boxed(rivalAt({ tyreAge: 10, owes: 0, window: [6, 7, 8] }), 'sc') - q)).toBeLessThanOrEqual(3 * shareSe(q, n));
    // tyres younger than aMin, no stop ahead, a VSC: it stays out
    expect(boxed(rivalAt({ tyreAge: 0, owes: 1, window: [6, 7, 8] }), 'sc')).toBe(0);
    expect(boxed(rivalAt({ tyreAge: 10, owes: 0, window: [10, 10, 10] }), 'sc')).toBe(0);
    expect(boxed(owes, 'vsc')).toBe(0);
  });

  it('stayOut: no stop while the neutralisation holds; a planned stop inside it moves to the first lap after it', () => {
    // our car alone ahead of a rival far behind; quiet; an SC out on laps 3–4 in every scenario
    const start = startingPoint({ lapsTotal: 8, cars: [{ gapMs: 0 }, { gapMs: 60_000 }], ours: [0] });
    const sc = hazard(8, { sc: { 2: 1 }, scDur: [0, 1] });
    const stayOut: Policy = { stops: [{ lap: 3, compound: 'hard' }], triggers: [{ kind: 'neutralised', condition: 'sc', fromLap: 3, toLap: 3, action: 'stayOut' }] };
    const moved = stopAt(5, 'hard');
    const underSc = stopAt(3, 'hard');
    const rows = carOf(scoreAll(mcInput(start, { 0: [stayOut, moved, underSc] }, { hazard: sc }), createRng(23), 50), 0).rows;
    const forecast = raceForecast(start, [moved, NO_STOP], drawn(1, [{ kind: 'sc', fromLap: 3, toLap: 4 }]), createRng(1));
    expect(Math.abs(rowOf(rows, stayOut).meanMs - forecast.raceTimeMs[0]!)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(rowOf(rows, stayOut).meanMs - rowOf(rows, underSc).meanMs)).toBeGreaterThan(1_000);
  });

  it("rivals: rivalNextCompound and hasStopAhead are the one source of a rival's next compound and stop ahead", () => {
    const rivalNextCompound = exported<(start: StartingPoint, k: number) => string | null>('rivalNextCompound');
    const hasStopAhead = exported<(start: StartingPoint, k: number) => boolean>('hasStopAhead');
    // slot 0: owes the rule, window ahead; slot 1: a window ahead, owes nothing; slot 2: no stop before the flag; slot 3 retired
    const start = startingPoint({ lap: 5, lapsTotal: 20, cars: [{ compound: 'medium' }, { compound: 'hard' }, { compound: 'soft' }, { retired: true }] });
    const windows: [number, number, number][] = [[8, 10, 12], [9, 11, 13], [20, 20, 20], [8, 10, 12]];
    windows.forEach(([low, mid, high], k) => {
      start.stopLow[k] = low;
      start.stopMid[k] = mid;
      start.stopHigh[k] = high;
    });
    start.owesStop[0] = 1;
    expect(hasStopAhead(start, 0)).toBe(true);
    expect(hasStopAhead(start, 1)).toBe(true);
    expect(hasStopAhead(start, 2)).toBe(false);
    expect(hasStopAhead(start, 3)).toBe(false);
    // owing the second dry compound: a dry compound other than its own (the compound rule's one judgement, C43)
    expect(['soft', 'hard']).toContain(rivalNextCompound(start, 0));
    expect(['soft', 'medium', 'hard']).toContain(rivalNextCompound(start, 1));
    expect(rivalNextCompound(start, 2)).toBeNull();
    expect(rivalNextCompound(start, 3)).toBeNull();
  });
});

describe('race-monte-carlo: determinism, the full evaluation, the ranking', () => {
  // row 13
  it('a seeded run is bit-identical', () => {
    const start = noisyField({ ours: [2, 3] });
    const hz = hazard(6, { sc: { 2: 0.2 }, vsc: { 3: 0.1 } });
    const input = () => mcInput(start, { 2: [NO_STOP, stopAt(2), stopAt(3, 'medium')], 3: [NO_STOP, stopAt(4)] }, { hazard: hz });
    expect(raceMonteCarlo(input(), createRng(31), 2_000)).toStrictEqual(raceMonteCarlo(input(), createRng(31), 2_000));
    const fieldInput = (): FieldInput => ({ start, plans: byCar({ 2: NO_STOP, 3: stopAt(4) }), hazard: hz, rivalRules: RIVAL_RULES, scenarios: 200, laps: [3, 6] });
    expect(fieldPositions(fieldInput(), createRng(32))).toStrictEqual(fieldPositions(fieldInput(), createRng(32)));
  });

  // row 14
  it('scoreAll scores every candidate on the same scenarios and drops none', () => {
    const start = noisyField();
    const twin: Policy = { stops: [], triggers: [] };
    const policies = [NO_STOP, stopAt(2, 'hard'), stopAt(3, 'medium'), twin];
    const n = 300;
    const result = carOf(scoreAll(mcInput(start, { 2: policies }, { hazard: hazard(6, { sc: { 2: 0.3 } }) }), createRng(41), n), 2);
    expect(result.scenarios).toBe(n);
    expect(result.rows).toHaveLength(4);
    for (const p of policies.slice(1, 3)) expect(rowsOf(result.rows, p)).toHaveLength(1);
    // the same policy twice: the same scenarios give the same outcome
    const twins = rowsOf(result.rows, NO_STOP);
    expect(twins).toHaveLength(2);
    expect(twins[1]!.positionPmf).toStrictEqual(twins[0]!.positionPmf);
    expect(twins[1]!.meanMs).toBe(twins[0]!.meanMs);
    // every row over all n scenarios: its pmf is counts over n
    for (const row of result.rows) for (const p of row.positionPmf) expect(Math.abs(p * n - Math.round(p * n))).toBeLessThan(1e-6);
  });

  it('rank: paired(a, b) is the mean and SE of b − a per scenario; ties below max(tieBand, zTie × SE)', () => {
    const paired = exported<(a: Float64Array, b: Float64Array) => { mean: number; se: number }>('paired');
    const ties = exported<(diff: { mean: number; se: number }, zTie: number, tieBand: number) => boolean>('ties');
    // differences 1, 0, 2, 0: mean 0.75, sample SD √(2.75 / 3), SE that over √4
    const d = paired(Float64Array.from([1, 2, 3, 4]), Float64Array.from([2, 2, 5, 4]));
    expect(d.mean).toBeCloseTo(0.75, 12);
    expect(d.se).toBeCloseTo(Math.sqrt(2.75 / 3) / 2, 12);
    expect(paired(Float64Array.from([3, 1, 4]), Float64Array.from([3, 1, 4]))).toEqual({ mean: 0, se: 0 });
    // within the band, within zTie SEs, outside both
    expect(ties({ mean: 0.04, se: 0.001 }, 2, 0.05)).toBe(true);
    expect(ties({ mean: 0.1, se: 0.06 }, 2, 0.05)).toBe(true);
    expect(ties({ mean: 0.1, se: 0.01 }, 2, 0.05)).toBe(false);
  });
});
