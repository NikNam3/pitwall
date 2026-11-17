// `race-monte-carlo`'s grid start (SP4.3d2 Task 8, spec §7.2; C2, C50; research 13, common random numbers). On a
// starting point with `start` set, before lap 1 of each scenario a car with `freeCompound` takes its policy's
// `startCompound`, and a rival with `odds` draws one option (compound and stop window) from a dedicated stream of the
// injected generator, the same draw for every candidate of the run. `start: null` plays as today.
//
// How these tests read the draws (the test agent's decisions, Task 8): a rival's drawn start is its scenario policy's
// `startCompound` (the policy `policiesIn` hands `race-forecast`, `Policy.startCompound`: "only before the start"), and
// its dry stop lap (`ScenarioEntry.rivalLaps`) is drawn from the drawn option's window (`stopLow` … `stopHigh`) in place
// of the starting point's. A car with neither keeps `compound[k]` and its policy carries no `startCompound`.
import { type NoiseCompound, type Policy, type StartingPoint, type StartOption } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { scoreAll } from '../../src/race-monte-carlo/index.ts';
import { createRun, policiesIn, scenarioOf } from '../../src/race-monte-carlo/scenarios.ts';
import { LAP_MODEL, startingPoint } from '../race-forecast/start.ts';
import { carOf, hazard, mcInput, RIVAL_RULES, ZERO_HAZARD } from './support.ts';

const LAPS = 10;

/** Car 1's options: three compounds, each its own stop window. */
const ODDS_1: StartOption[] = [
  { compound: 'soft', p: 0.5, stopLow: 2, stopMid: 3, stopHigh: 4 },
  { compound: 'medium', p: 0.3, stopLow: 5, stopMid: 6, stopHigh: 7 },
  { compound: 'hard', p: 0.2, stopLow: 7, stopMid: 8, stopHigh: 9 },
];
/** Car 2's options: two compounds. */
const ODDS_2: StartOption[] = [
  { compound: 'medium', p: 0.65, stopLow: 3, stopMid: 4, stopHigh: 5 },
  { compound: 'hard', p: 0.35, stopLow: 6, stopMid: 7, stopHigh: 8 },
];

/** The compound offsets differ, so a start compound changes a car's race time. */
const OFFSETS = { ...LAP_MODEL, compoundOffsetMs: { soft: -400, medium: 0, hard: 300, inter: 0, wet: 0 } };

/**
 * A quiet four-car grid of `LAPS` laps, our car slot 0; rivals 1, 2 and 3 with a stop ahead in the starting point's
 * window 4–6 (which no drawn option of cars 1 and 2 equals). `start` as given (default `null`).
 */
function grid(start: StartingPoint['start'] = null, o: { compound0?: NoiseCompound } = {}): StartingPoint {
  const s = startingPoint({ lapsTotal: LAPS, cars: [{ compound: o.compound0 ?? 'medium' }, {}, {}, {}], ours: [0], lapModel: OFFSETS });
  for (const k of [1, 2, 3]) {
    s.stopLow[k] = 4;
    s.stopMid[k] = 5;
    s.stopHigh[k] = 6;
  }
  return { ...s, start };
}

const gridStart = (): NonNullable<StartingPoint['start']> => ({ freeCompound: Uint8Array.from([1, 0, 0, 0]), odds: [null, ODDS_1, ODDS_2, null] });

const run = (start: StartingPoint, seed: number, hz = ZERO_HAZARD(LAPS)) => createRun(start, hz, RIVAL_RULES, {}, createRng(seed));

describe('race-monte-carlo: the grid start (SP4.3d2 Task 8, spec §7.2)', () => {
  // Step 1 row 3
  it('two candidates in one run see the same rival start draws', () => {
    const r = run(grid(gridStart()), 11);
    const a: Policy = { startCompound: 'soft', stops: [{ lap: 4, compound: 'hard' }] };
    const b: Policy = { startCompound: 'hard', stops: [{ lap: 7, compound: 'medium' }] };
    const seen = new Set<string>();
    for (let id = 0; id < 200; id++) {
      const pa = policiesIn(r, id, 0, a);
      const pb = policiesIn(r, id, 0, b);
      for (const k of [1, 2, 3]) expect(pb[k], `scenario ${id}, car ${k}`).toEqual(pa[k]);
      for (const k of [1, 2]) {
        expect(pa[k]!.startCompound, `scenario ${id}, car ${k} draws a start`).toBeDefined();
        seen.add(`${k}:${pa[k]!.startCompound}`);
      }
      expect('startCompound' in pa[3]!, `scenario ${id}: car 3 has no odds and keeps its compound`).toBe(false);
      // our free car takes its candidate's start compound
      expect(pa[0]!.startCompound).toBe('soft');
      expect(pb[0]!.startCompound).toBe('hard');
    }
    // the draws vary across scenarios: every option is drawn
    expect([...seen].sort()).toEqual(['1:hard', '1:medium', '1:soft', '2:hard', '2:medium']);
  });

  // Step 1 row 4
  it("over 10 000 scenarios each compound's frequency is within 2 % of its odds, each stop in its drawn option's window", () => {
    const r = run(grid(gridStart()), 23);
    const n = 10_000;
    const counts: Record<number, Partial<Record<NoiseCompound, number>>> = { 1: {}, 2: {} };
    for (let id = 0; id < n; id++) {
      const entry = scenarioOf(r, id);
      for (const [k, odds] of [[1, ODDS_1], [2, ODDS_2]] as const) {
        const c = entry.rivals[k]!.startCompound;
        const option = odds.find((x) => x.compound === c);
        expect(option, `scenario ${id}, car ${k}: drew ${c}`).toBeDefined();
        counts[k]![c!] = (counts[k]![c!] ?? 0) + 1;
        const lap = entry.rivalLaps[k]!;
        expect(lap >= option!.stopLow && lap <= option!.stopHigh, `scenario ${id}, car ${k}: stop lap ${lap} in ${c}'s window ${option!.stopLow}–${option!.stopHigh}`).toBe(true);
      }
    }
    for (const [k, odds] of [[1, ODDS_1], [2, ODDS_2]] as const) {
      for (const option of odds) {
        const share = (counts[k]![option.compound] ?? 0) / n;
        expect(Math.abs(share - option.p), `car ${k}, ${option.compound}: ${share} against ${option.p}`).toBeLessThanOrEqual(0.02);
      }
    }
  }, 30_000);

  // the interface: a car with freeCompound plays its policy's startCompound
  it("our free car plays its policy's startCompound: as the same car fitted with that compound on a start without one", () => {
    const free = { freeCompound: Uint8Array.from([1, 0, 0, 0]), odds: [null, null, null, null] };
    for (const c of ['soft', 'hard'] as const) {
      const policy: Policy = { startCompound: c, stops: [{ lap: 5, compound: 'medium' }] };
      const onGrid = carOf(scoreAll(mcInput(grid(free), { 0: [policy] }), createRng(3), 40), 0).rows[0]!;
      const fitted = carOf(scoreAll(mcInput(grid(null, { compound0: c }), { 0: [{ stops: policy.stops }] }), createRng(3), 40), 0).rows[0]!;
      expect(onGrid.meanMs, `start on ${c}`).toBeCloseTo(fitted.meanMs, 6);
    }
    const soft = carOf(scoreAll(mcInput(grid(free), { 0: [{ startCompound: 'soft', stops: [{ lap: 5, compound: 'medium' }] }] }), createRng(3), 40), 0).rows[0]!;
    const hard = carOf(scoreAll(mcInput(grid(free), { 0: [{ startCompound: 'hard', stops: [{ lap: 5, compound: 'medium' }] }] }), createRng(3), 40), 0).rows[0]!;
    expect(soft.meanMs, 'the start compound matters').toBeLessThan(hard.meanMs);
  });

  // Step 1 row 5
  it('a car with start: null plays as today: no start drawn, the same result as a grid with neither free compound nor odds', () => {
    const none = grid(null);
    const neither = grid({ freeCompound: new Uint8Array(4), odds: [null, null, null, null] });
    const policy: Policy = { stops: [{ lap: 5, compound: 'hard' }] };
    // an SC chance on every lap, so the scenarios' neutralisations and the rivals' SC reactions draw
    const hz = hazard(LAPS, { sc: Object.fromEntries(Array.from({ length: LAPS }, (_, i) => [i, 0.15])), scDur: [0.5, 0.5] });
    const rNone = run(none, 5, hz);
    const rNeither = run(neither, 5, hz);
    const rDrawn = run(grid(gridStart()), 5, hz);
    for (let id = 0; id < 100; id++) {
      const a = policiesIn(rNone, id, 0, policy);
      const b = policiesIn(rNeither, id, 0, policy);
      expect(b, `scenario ${id}`).toEqual(a);
      for (const p of a) expect('startCompound' in p, `scenario ${id}: ${JSON.stringify(p)}`).toBe(false);
      // the start draws' stream is its own: drawing cars 1 and 2's starts leaves the scenario's other draws as they were
      expect(scenarioOf(rDrawn, id).rivalLaps[3], `scenario ${id}: car 3's stop`).toBe(scenarioOf(rNone, id).rivalLaps[3]);
      expect(scenarioOf(rDrawn, id).scenario.neutralisations, `scenario ${id}`).toEqual(scenarioOf(rNone, id).scenario.neutralisations);
    }
    const score = (s: StartingPoint) => scoreAll(mcInput(s, { 0: [policy, { stops: [] }] }, { hazard: hz }), createRng(9), 60);
    expect(score(neither)).toEqual(score(none));
  });

  // Step 1 row 6
  it('same seed → bit-identical output on a grid start', () => {
    const cands = { 0: [{ startCompound: 'soft', stops: [{ lap: 4, compound: 'hard' }] }, { startCompound: 'medium', stops: [{ lap: 6, compound: 'hard' }] }] as Policy[] };
    const a = scoreAll(mcInput(grid(gridStart()), cands), createRng(17), 200);
    const b = scoreAll(mcInput(grid(gridStart()), cands), createRng(17), 200);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const ra = run(grid(gridStart()), 17);
    const rb = run(grid(gridStart()), 17);
    for (let id = 0; id < 50; id++) expect(scenarioOf(rb, id).rivals).toEqual(scenarioOf(ra, id).rivals);
  });
});
