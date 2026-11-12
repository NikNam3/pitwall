// `race-monte-carlo`'s selection and the parts that must earn their place (SP4.3b spec §7.3, §7.4, §12.3; Task 19). The
// small good-selection check runs in `pnpm check`; the full one against the 50,000-scenario reference is Task 20b's.
// Rows 10 and 11 print what spec §12.3 records; they assert only what holds whichever way the ranking falls.
import type { LapModelParams, Policy, StartingPoint } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceMonteCarlo, scoreAll } from '../../src/race-monte-carlo/index.ts';
import { DOUBLE_STACK_MS } from '../../src/race-forecast/constants.ts';
import { LAP_MODEL, NOISY, startingPoint, type CarSpec } from '../race-forecast/start.ts';
import { candidate, carOf, hazard, mcInput, rowOf, stopAt, NO_STOP, type Row } from './support.ts';

/** The compounds a few tenths apart; worn tyres cost 30 ms per % wear. */
const LAP: LapModelParams = { ...LAP_MODEL, compoundOffsetMs: { soft: 0, medium: 200, hard: 400, inter: 0, wet: 0 } };

/** The 5-lap, 6-car test race: our car (slot 2) on worn mediums, a cheap stop, so stopping and staying out are close. */
function testRace(o: { mistakes?: boolean; ours?: number[] } = {}): StartingPoint {
  const quietMistakes = o.mistakes === false ? { mistakeRate: 0, bigEventRate: 0 } : {};
  const cars: CarSpec[] = Array.from({ length: 6 }, (_, i) => ({ ...NOISY, ...quietMistakes, retireRate: 0, gapMs: 1_500 * i, paceMs: 90_000 + 50 * i, degMsPerLap: 30 }));
  cars[2] = { ...cars[2], wearPct: 50, tyreAge: 12 };
  return startingPoint({ lapsTotal: 5, cars, ours: o.ours ?? [2], lapModel: LAP, pitLossMs: { green: 6_000, vsc: 4_000, sc: 3_000, inLapShare: 0.3 } });
}

const CANDIDATES: Policy[] = [NO_STOP, stopAt(1, 'medium'), stopAt(2, 'medium'), stopAt(3, 'medium'), stopAt(2, 'hard')];
const HAZARD = hazard(5, { sc: { 1: 0.05, 2: 0.05, 3: 0.05 }, vsc: { 2: 0.05 } });

const ranking = (rows: Row[]): string => rows.map((r) => `${r.policy.stops.map((s) => `${s.lap}${s.compound[0]}`).join('+') || 'none'} ${r.ePos.toFixed(3)}${r.tie ? ' (tie)' : ''}`).join(' | ');

describe('race-monte-carlo: selection', () => {
  // row 8
  it(
    'small good selection: on a 5-lap, 6-car test race the capped search (maxScenarioPolicies 2,000) picks a winner within 0.05 places of scoreAll with 20,000 scenarios per candidate',
    { timeout: 60_000 },
    () => {
      const start = testRace();
      const reference = carOf(scoreAll(mcInput(start, { 2: CANDIDATES }, { hazard: HAZARD }), createRng(81), 20_000), 2).rows;
      const best = Math.min(...reference.map((r) => r.ePos));
      const capped = carOf(raceMonteCarlo(mcInput(start, { 2: CANDIDATES }, { hazard: HAZARD, config: { maxScenarioPolicies: 2_000 } }), createRng(82), 2_000), 2);
      const winner = capped.rows[0]!;
      expect(rowOf(reference, winner.policy).ePos - best).toBeLessThanOrEqual(0.05);
    },
  );

  // row 10
  it('cover-rule ablation: coverRule on vs off on the test race; the test prints whether the top policy changes', { timeout: 30_000 }, () => {
    const start = testRace();
    const run = (coverRule: boolean) => carOf(raceMonteCarlo(mcInput(start, { 2: CANDIDATES }, { hazard: HAZARD, rivalRules: { coverRule } }), createRng(91), 5_000), 2).rows;
    const off = run(false);
    const on = run(true);
    expect(off.length).toBeGreaterThan(0);
    expect(on.length).toBeGreaterThan(0);
    const changed = JSON.stringify(off[0]!.policy) !== JSON.stringify(on[0]!.policy);
    console.log(`[spec §12.3 cover-rule ablation] top policy ${changed ? 'changes' : 'unchanged'}\n  off: ${ranking(off)}\n  on:  ${ranking(on)}`);
  });

  // row 11
  it('split-or-stack: both our cars boxing on one lap pay the double-stack wait; the test prints the ranking with and without the mistake process', { timeout: 30_000 }, () => {
    // quiet: our car 1 leads our car 0 by 2 s and is committed to box at the end of lap 3; stacking behind it waits
    const quiet = startingPoint({ lapsTotal: 6, cars: [{ gapMs: 2_000 }, { gapMs: 0 }, { gapMs: 40_000 }], ours: [0, 1] });
    const committed = stopAt(3);
    const stack = stopAt(3);
    const split = stopAt(4);
    const rows = carOf(scoreAll(mcInput(quiet, { 0: [stack, split], 1: [candidate(committed, 'committed')] }, { committed: { 1: committed } }), createRng(101), 50), 0).rows;
    expect(Math.abs(rowOf(rows, stack).meanMs - rowOf(rows, split).meanMs - (DOUBLE_STACK_MS - 2_000))).toBeLessThanOrEqual(5);

    // noisy: our cars side by side (slots 2 and 3), slot 3 committed to lap 3; slot 2 splits or stacks
    const ranked = (mistakes: boolean): Row[] => {
      const start = testRace({ mistakes, ours: [2, 3] });
      const input = mcInput(start, { 2: [stopAt(2, 'hard'), stopAt(3, 'hard'), stopAt(4, 'hard')], 3: [candidate(stopAt(3, 'hard'), 'committed')] }, { hazard: HAZARD, committed: { 3: stopAt(3, 'hard') } });
      return carOf(raceMonteCarlo(input, createRng(102), 5_000), 2).rows;
    };
    const withMistakes = ranked(true);
    const without = ranked(false);
    expect(withMistakes.length).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(0);
    console.log(`[spec §12.3 split-or-stack] (teammate boxes lap 3)\n  with mistakes:    ${ranking(withMistakes)}\n  without mistakes: ${ranking(without)}`);
  });
});
