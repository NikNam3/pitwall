// `scoreCalls` (SP4.3b2 Task 4; spec §9; C2, C3, C43, C50): a call's cases scored on common scenarios, no search,
// nothing dropped; a candidate's `rival` replaces that rival's drawn stops in that candidate only; each scenario stops at
// our crossing of `untilLap`. Starting points are built by hand (`../race-forecast/start.ts`); `support.ts` states how
// these tests read the simulator's inputs.
//
// How these tests read `CallOutcome` (the test agent's decisions, Task 4 report):
// - A "quiet" field (every noise term 0, the cars at least 5 s apart unless stated) gives the same forecast in every
//   scenario; its outcomes are compared with `raceForecast` on the same policies and neutralisations (tolerance 1e-6).
// - `gapMs` at `gapAtLap` is read as the rival's gap to the leader less ours at the line ending that lap (the trace).
// - `raceMs` with `untilLap` L, our car leading, is `raceForecast`'s `raceTimeMs` with `toLap: L`.
// - A stop "at lap L" boxes at the end of lap L; its first line crossing after is the line ending lap L + 1 (the cases
//   are built so the line ending lap L gives the same position).
import type { CarId, Policy, StartingPoint } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceMonteCarlo, scoreAll, scoreCalls, type CallCandidate, type CallInput, type CallOutcome, type McCandidate } from '../../src/race-monte-carlo/index.ts';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { drawn, NOISY, PLAIN, startingPoint, traceAt, type CarSpec } from '../race-forecast/start.ts';
import { carOf, hazard, mcInput, NO_STOP, RIVAL_RULES, rowOf, shareSe, stopAt, ZERO_HAZARD, type Hazard } from './support.ts';

const TRAFFIC = { gapMs: 1_000, laps: 3 };

const cand = (policy: Policy, o: { rival?: CallCandidate['rival']; untilLap?: number | null } = {}): CallCandidate => ({ policy, rival: o.rival ?? null, untilLap: o.untilLap ?? null });

/** A call for our car `car` over `start` (its `sets` are our cars), nothing committed by default. */
function callInput(
  start: StartingPoint,
  car: number,
  candidates: CallCandidate[],
  o: { hazard?: Hazard; committed?: Record<number, Policy | null>; scenarios?: number; traffic?: CallInput['traffic']; rivalRules?: Partial<CallInput['rivalRules']> } = {},
): CallInput {
  const committed: Record<CarId, Policy | null> = {};
  for (const key of Object.keys(start.sets)) committed[Number(key) as CarId] = o.committed?.[Number(key)] ?? null;
  return {
    start,
    car: car as CarId,
    candidates,
    committed,
    hazard: o.hazard ?? ZERO_HAZARD(start.lapsTotal - start.lap + 1),
    rivalRules: { ...RIVAL_RULES, ...o.rivalRules },
    scenarios: o.scenarios ?? 200,
    traffic: o.traffic ?? TRAFFIC,
  };
}

const outcome = (r: { outcomes: CallOutcome[] }, i: number): CallOutcome => {
  const o = r.outcomes[i];
  if (o === undefined) throw new Error(`no outcome ${i}`);
  return o;
};

/** A six-car field with the AI field's noise, no retirements, 1.5 s apart; our car `ours` (default slot 0, the leader). */
function noisyField(o: { ours?: number[]; lapsTotal?: number } = {}): StartingPoint {
  const cars: CarSpec[] = Array.from({ length: 6 }, (_, i) => ({ ...NOISY, retireRate: 0, gapMs: 1_500 * i, paceMs: 90_000 + 60 * i }));
  return startingPoint({ lapsTotal: o.lapsTotal ?? 8, cars, ours: o.ours ?? [0] });
}

/** A rival's stop window fixed at `lap` (low = mid = high): it boxes at the end of `lap` in every scenario. */
function windowAt(start: StartingPoint, k: number, lap: number): void {
  start.stopLow[k] = lap;
  start.stopMid[k] = lap;
  start.stopHigh[k] = lap;
}

const expectClose = (a: ArrayLike<number>, b: number): void => {
  for (let i = 0; i < a.length; i++) expect(Math.abs((a[i] ?? Number.NaN) - b)).toBeLessThanOrEqual(1e-6);
};

const share = (a: ArrayLike<number>, p: (v: number) => boolean): number => {
  let k = 0;
  for (let i = 0; i < a.length; i++) if (p(a[i] ?? Number.NaN)) k++;
  return k / a.length;
};

describe('scoreCalls: common scenarios (spec §9, §7.1)', () => {
  // row 1
  it('scenario i draws the same neutralisations, weather, pace and noise for every candidate', () => {
    const start = noisyField();
    const hz = hazard(8, { sc: { 1: 0.3, 2: 0.2 }, vsc: { 1: 0.2 }, scDur: [0.5, 0.5] });
    const n = 200;
    // the two policies are the same up to our crossing of lap 3: every scenario gives both the same outcome there
    const a = cand(NO_STOP, { untilLap: 3 });
    const b = cand(stopAt(5, 'hard'), { untilLap: 3 });
    const both = scoreCalls(callInput(start, 0, [a, b], { hazard: hz, scenarios: n }), createRng(11));
    expect(both.outcomes).toHaveLength(2);
    for (const o of both.outcomes) {
      expect(o.finish).toHaveLength(n);
      expect(o.raceMs).toHaveLength(n);
    }
    expect(outcome(both, 1).finish).toStrictEqual(outcome(both, 0).finish);
    expect(outcome(both, 1).raceMs).toStrictEqual(outcome(both, 0).raceMs);
    // the scenarios differ from each other (the noise is drawn), and do not depend on which candidates are scored
    expect(new Set(outcome(both, 0).raceMs).size).toBeGreaterThan(1);
    const alone = scoreCalls(callInput(start, 0, [a], { hazard: hz, scenarios: n }), createRng(11));
    expect(outcome(alone, 0).raceMs).toStrictEqual(outcome(both, 0).raceMs);
    expect(outcome(alone, 0).finish).toStrictEqual(outcome(both, 0).finish);
  });

  // row 2
  it("a candidate's forced rival stop changes only that candidate's rival", () => {
    // quiet: our car (slot 0) leads, rival 1 10 s behind (window lap 5), rival 2 25 s behind (window lap 4)
    const start = startingPoint({ lapsTotal: 8, cars: [{ gapMs: 0 }, { gapMs: 10_000 }, { gapMs: 25_000 }], ours: [0] });
    windowAt(start, 1, 5);
    windowAt(start, 2, 4);
    const forced = stopAt(2, 'hard');
    const a = cand(NO_STOP, { rival: { carId: 1 as CarId, policy: forced, gapAtLap: 4 } });
    const b = cand(NO_STOP, { rival: { carId: 1 as CarId, policy: stopAt(5, 'medium'), gapAtLap: 4 } });
    const plain = cand(NO_STOP);
    const result = scoreCalls(callInput(start, 0, [a, b, plain], { scenarios: 20 }), createRng(5));
    // in a: rival 1 boxes at lap 2 as forced; rival 2 keeps its drawn stop at lap 4
    const withForced = raceForecast(start, [NO_STOP, forced, stopAt(4, 'medium')], drawn(1), createRng(1), { trace: true });
    const lap4 = traceAt(withForced, 4);
    expectClose(outcome(result, 0).gapMs ?? [], (lap4.gapMs[1] ?? 0) - (lap4.gapMs[0] ?? 0));
    // in b and without a rival: both rivals follow their drawn stops; a's forced stop does not reach them
    const drawnStops = raceForecast(start, [NO_STOP, stopAt(5, 'medium'), stopAt(4, 'medium')], drawn(1), createRng(1), { trace: true });
    const lap4b = traceAt(drawnStops, 4);
    expectClose(outcome(result, 1).gapMs ?? [], (lap4b.gapMs[1] ?? 0) - (lap4b.gapMs[0] ?? 0));
    expectClose(outcome(result, 2).raceMs, drawnStops.raceTimeMs[0] ?? Number.NaN);
    expect(outcome(result, 2).gapMs).toBeNull();
    const bAlone = scoreCalls(callInput(start, 0, [b, plain], { scenarios: 20 }), createRng(5));
    expect(outcome(bAlone, 0)).toStrictEqual(outcome(result, 1));
    expect(outcome(bAlone, 1)).toStrictEqual(outcome(result, 2));
  });

  // row 3
  it('gapMs is positive when we cross gapAtLap first', () => {
    // quiet: our car 10 s ahead of the rival, then (another field) 10 s behind it; nobody stops
    const ahead = startingPoint({ lapsTotal: 6, cars: [{ gapMs: 0 }, { gapMs: 10_000 }], ours: [0] });
    const behind = startingPoint({ lapsTotal: 6, cars: [{ gapMs: 0 }, { gapMs: 10_000 }], ours: [1] });
    const gaps = (start: StartingPoint, car: number, rival: number): Float64Array => {
      const c = cand(NO_STOP, { rival: { carId: rival as CarId, policy: NO_STOP, gapAtLap: 3 } });
      const g = outcome(scoreCalls(callInput(start, car, [c], { scenarios: 20 }), createRng(3)), 0).gapMs;
      if (g === null) throw new Error('no gapMs for a candidate with a rival');
      return g;
    };
    for (const g of gaps(ahead, 0, 1)) expect(g).toBeGreaterThan(0);
    for (const g of gaps(behind, 1, 0)) expect(g).toBeLessThan(0);
    const trace = traceAt(raceForecast(ahead, [NO_STOP, NO_STOP], drawn(1), createRng(1), { trace: true }), 3);
    expectClose(gaps(ahead, 0, 1), (trace.gapMs[1] ?? 0) - (trace.gapMs[0] ?? 0));
  });
});

describe('scoreCalls: rejoin and traffic (spec §9.2, §9.4)', () => {
  // row 4
  it('rejoin is -1 for a candidate without a stop', () => {
    const start = noisyField();
    const result = scoreCalls(callInput(start, 0, [cand(NO_STOP), cand(stopAt(3, 'hard'))], { hazard: hazard(8, { sc: { 2: 0.3 } }), scenarios: 100 }), createRng(7));
    for (const r of outcome(result, 0).rejoin) expect(r).toBe(-1);
    for (const r of outcome(result, 1).rejoin) expect(r).toBeGreaterThan(0);
  });

  // row 4b
  it('rejoin is our position at our first line crossing after the stop', () => {
    // two cars, quiet; a stop costs 22 s, half of it before the line: with a 5 s lead we rejoin second, with 40 s first
    const pitLossMs = { green: 22_000, vsc: 13_000, sc: 11_000, inLapShare: 0.5 };
    const rejoin = (leadMs: number): Int8Array => {
      const start = startingPoint({ lapsTotal: 6, cars: [{ gapMs: 0 }, { gapMs: leadMs }], ours: [0], pitLossMs });
      return outcome(scoreCalls(callInput(start, 0, [cand(stopAt(2, 'hard'))], { scenarios: 20 }), createRng(9)), 0).rejoin;
    };
    for (const r of rejoin(5_000)) expect(r).toBe(2);
    for (const r of rejoin(40_000)) expect(r).toBe(1);
  });

  // row 5
  it('traffic counts a car within gapMs once, however many laps', () => {
    // quiet: our car leads car 1 by 21 s and boxes at lap 2 (22 s, all after the line): it rejoins about 1 s behind car 1,
    // at the same pace, for all three laps; car 2 is a minute behind
    const start = startingPoint({ lapsTotal: 8, cars: [{ gapMs: 0 }, { gapMs: 21_000 }, { gapMs: 80_000 }], ours: [0] });
    const result = scoreCalls(callInput(start, 0, [cand(stopAt(2, 'hard'))], { scenarios: 20, traffic: { gapMs: 3_000, laps: 3 } }), createRng(13));
    for (const t of outcome(result, 0).traffic) expect(t).toBe(1);
  });
});

describe('scoreCalls: the plain forecast, determinism, the hazard (spec §7.1, C2)', () => {
  // row 6
  it("the finishing order with zero spread is the plain forecast's", () => {
    // quiet, 5 s apart, our car third; no neutralisation drawn
    const cars: CarSpec[] = Array.from({ length: 5 }, (_, i) => ({ gapMs: 5_000 * i, paceMs: 90_000 + 100 * i }));
    const start = startingPoint({ lapsTotal: 8, cars, ours: [2] });
    const policies = [NO_STOP, stopAt(3, 'hard')];
    const result = scoreCalls(callInput(start, 2, policies.map((p) => cand(p)), { scenarios: 50 }), createRng(17));
    policies.forEach((p, i) => {
      const field = cars.map((_, k) => (k === 2 ? p : NO_STOP));
      const plain = raceForecast(start, field, PLAIN, createRng(1));
      for (const f of outcome(result, i).finish) expect(f).toBe(plain.position[2]);
      expectClose(outcome(result, i).raceMs, plain.raceTimeMs[2] ?? Number.NaN);
    });
  });

  // row 7
  it('a seeded call is bit-identical', () => {
    const start = noisyField({ ours: [2] });
    windowAt(start, 1, 4);
    const hz = hazard(8, { sc: { 2: 0.2 }, vsc: { 3: 0.1 } });
    const input = (): CallInput =>
      callInput(start, 2, [cand(NO_STOP), cand(stopAt(2, 'hard'), { rival: { carId: 1 as CarId, policy: stopAt(3, 'medium'), gapAtLap: 4 }, untilLap: 5 }), cand(stopAt(4, 'medium'))], {
        hazard: hz,
        scenarios: 150,
      });
    expect(scoreCalls(input(), createRng(31))).toStrictEqual(scoreCalls(input(), createRng(31)));
  });

  // row 8
  it('an active forced neutralisation in input.hazard holds in every scenario', () => {
    // one car alone, quiet; an SC out now with 2 laps left (out on laps 1–3): the race time is that forecast's everywhere
    const start = startingPoint({ lapsTotal: 8, cars: [{}], ours: [0] });
    const hz = hazard(8, { active: { condition: 'sc', remaining: Float64Array.from([0, 0, 1]) } });
    const result = scoreCalls(callInput(start, 0, [cand(NO_STOP)], { hazard: hz, scenarios: 100 }), createRng(19));
    const underSc = raceForecast(start, [NO_STOP], drawn(1, [{ kind: 'sc', fromLap: 1, toLap: 3 }]), createRng(1));
    const green = raceForecast(start, [NO_STOP], drawn(1), createRng(1));
    expect(Math.abs((underSc.raceTimeMs[0] ?? 0) - (green.raceTimeMs[0] ?? 0))).toBeGreaterThan(1_000);
    expectClose(outcome(result, 0).raceMs, underSc.raceTimeMs[0] ?? Number.NaN);
  });

  // row 9
  it("a candidate with untilLap stops there; its draws up to it equal the to-the-flag run's", () => {
    // quiet: our car leads; at lap 4 its race time is the forecast's to lap 4
    const quiet = startingPoint({ lapsTotal: 8, cars: [{ gapMs: 0 }, { gapMs: 10_000 }], ours: [0] });
    const early = scoreCalls(callInput(quiet, 0, [cand(stopAt(2, 'hard'), { untilLap: 4 })], { scenarios: 20 }), createRng(23));
    const toLap4 = raceForecast(quiet, [stopAt(2, 'hard'), NO_STOP], drawn(1), createRng(1), { toLap: 4 });
    expectClose(outcome(early, 0).raceMs, toLap4.raceTimeMs[0] ?? Number.NaN);
    // noisy: the same candidate to lap 4 and to the flag share every draw up to lap 4
    const start = noisyField();
    const hz = hazard(8, { sc: { 1: 0.3 }, vsc: { 2: 0.2 } });
    const rival = { carId: 1 as CarId, policy: stopAt(3, 'medium'), gapAtLap: 3 };
    const traffic = { gapMs: 1_000, laps: 1 };
    const result = scoreCalls(callInput(start, 0, [cand(stopAt(2, 'hard'), { rival, untilLap: 4 }), cand(stopAt(2, 'hard'), { rival, untilLap: null })], { hazard: hz, scenarios: 150, traffic }), createRng(29));
    const [until, flag] = [outcome(result, 0), outcome(result, 1)];
    expect(until.rejoin).toStrictEqual(flag.rejoin);
    expect(until.traffic).toStrictEqual(flag.traffic);
    expect(until.gapMs).toStrictEqual(flag.gapMs);
    for (let i = 0; i < until.raceMs.length; i++) expect(until.raceMs[i]!).toBeLessThan(flag.raceMs[i]!);
  });
});

describe('scoreCalls: the rivals and our teammate (spec §7.2, S14)', () => {
  // row 10
  it("the rivals' SC rule holds inside scoreCalls: under a forced SC a rival with a stop ahead and tyres ≥ aMin boxes with chance q, none under a VSC", () => {
    // the rival (slot 0) leads our car (slot 1) by 2 s; a stop's loss is paid before the line (in-lap share 1); its window
    // lies at laps 6–8; the neutralisation is out now with 1 lap left (laps 1–2): at lap 4 we lead only if it boxed
    const rivalAt = (tyreAge: number): StartingPoint => {
      const start = startingPoint({ lapsTotal: 10, cars: [{ gapMs: 0, tyreAge }, { gapMs: 2_000 }], ours: [1], pitLossMs: { green: 22_000, vsc: 13_000, sc: 11_000, inLapShare: 1 } });
      [start.stopLow[0], start.stopMid[0], start.stopHigh[0]] = [6, 7, 8];
      return start;
    };
    const n = 2_000;
    const boxed = (start: StartingPoint, condition: 'sc' | 'vsc'): number => {
      const hz = hazard(10, { active: { condition, remaining: Float64Array.from([0, 1]) } });
      const finish = outcome(scoreCalls(callInput(start, 1, [cand(NO_STOP, { untilLap: 4 })], { hazard: hz, scenarios: n }), createRng(37)), 0).finish;
      return share(finish, (p) => p === 1);
    };
    const q = RIVAL_RULES.q;
    expect(Math.abs(boxed(rivalAt(10), 'sc') - q)).toBeLessThanOrEqual(3 * shareSe(q, n));
    expect(boxed(rivalAt(0), 'sc')).toBe(0);
    expect(boxed(rivalAt(10), 'vsc')).toBe(0);
  });

  // row 11
  it('a committed teammate follows its policy in every scenario of every candidate', () => {
    // quiet: our teammate (slot 0) leads our car (slot 1) by 5 s and is committed to box at lap 2; a rival far behind
    const start = startingPoint({ lapsTotal: 8, cars: [{ gapMs: 0 }, { gapMs: 5_000 }, { gapMs: 60_000 }], ours: [0, 1] });
    const committed = stopAt(2, 'hard');
    const policies = [NO_STOP, stopAt(4, 'medium'), stopAt(5, 'hard')];
    const result = scoreCalls(callInput(start, 1, policies.map((p) => cand(p)), { committed: { 0: committed }, scenarios: 50 }), createRng(41));
    policies.forEach((p, i) => {
      const f = raceForecast(start, [committed, p, NO_STOP], drawn(1), createRng(1));
      expectClose(outcome(result, i).raceMs, f.raceTimeMs[1] ?? Number.NaN);
      for (const pos of outcome(result, i).finish) expect(pos).toBe(f.position[1]);
    });
  });
});

describe("race-monte-carlo: the rows' rule (4.3b2)", () => {
  // row 12
  it("raceMonteCarlo's rows carry their candidate's rule", () => {
    const start = noisyField({ ours: [2] });
    const cands: McCandidate[] = [
      { policy: NO_STOP, source: 'dp', rule: null },
      { policy: stopAt(2, 'hard'), source: 'rule', rule: 'mirrorAhead' },
      { policy: stopAt(4, 'medium'), source: 'rule', rule: 'extend' },
    ];
    for (const result of [raceMonteCarlo(mcInput(start, { 2: cands }), createRng(43), 2_000), scoreAll(mcInput(start, { 2: cands }), createRng(43), 100)]) {
      const rows = carOf(result, 2).rows;
      for (const c of cands) expect(rowOf(rows, c.policy).rule).toBe(c.rule);
    }
  });
});
