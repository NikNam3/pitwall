// Properties of the three per-lap-gain rates (tyre wear, fuel burn, ERS store trend) on generated stints. The wear rate
// is `tyre-model`'s (SP4.3c Task 12, spec §5.2: the judgement moved there from `tyre-life`, and wear left `per-lap-rate`;
// its measured rate is the cumulative gain over the newest ≤ 5 green laps, from 3 gain laps and 5 % accrued, research
// 21 §2; before that the game's prior). No `degradation` or `track-wetness` output here (tyre-model reads them absent).
// The three calculators are stateless quick calculators (one compute over the view), so incremental = from scratch and
// flashback hold by construction and have no property here (docs/testing.md section 5: incremental calculators only).
import { carId, known, unknown, type Corners, type LapRecord, type Percent } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ersCalculator } from '../../src/ers/calculator.ts';
import { fuelCalculator } from '../../src/fuel/calculator.ts';
import { SESSION_REMAINING, type SessionRemaining } from '../../src/session-remaining/index.ts';
import { tyreModelCalculator } from '../../src/tyre-model/index.ts';
import { carState, lap } from '../../../../test-support/builders/index.ts';
import { guardedQuick, situatedView } from '../situated.ts';
import { liveSets, tyreSet } from '../tyre-model/support.ts';

/** The three calculators through their guarded views (C41), on views with car 0 in the session (its car-status span). */
const tyreModelCalc = guardedQuick(tyreModelCalculator);
const fuelCalc = guardedQuick(fuelCalculator);
const ersCalc = guardedQuick(ersCalculator);

const MJ = 1_000_000;
const corners = <T>(v: T): Corners<T> => ({ fl: v, fr: v, rl: v, rr: v });

/** What happens on one generated lap; `neutralised` is its SC share (0, the flag lag 0.01, or 0.5). */
type GenLap = {
  wearGain: number;
  burnKg: number;
  ersChangeMJ: number;
  neutralised: 0 | 0.01 | 0.5;
  inLap: boolean;
  outLap: boolean;
  joined: boolean;
};

/** True on about one lap in `n`. */
const rarely = (n: number) => fc.integer({ min: 1, max: n }).map((k) => k === 1);

const genLap: fc.Arbitrary<GenLap> = fc.record({
  wearGain: fc.integer({ min: 0, max: 5 }),
  burnKg: fc.integer({ min: 1, max: 4 }).map((n) => n / 2),
  ersChangeMJ: fc.integer({ min: -4, max: 4 }).map((n) => n / 10),
  neutralised: fc.constantFrom(0 as const, 0.01 as const, 0.5 as const),
  inLap: rarely(6),
  outLap: rarely(6),
  joined: rarely(8),
});

/** Car 0's laps 1..n of one stint on mediums (C3), each starting where the one before ended; a `joined` lap has unknown start samples. */
function lapsOf(gen: GenLap[]): LapRecord[] {
  let wear = 0;
  let fuel = 100;
  let ers = 2;
  return gen.map((g, i) => {
    const n = i + 1;
    const at = n * 90_000;
    const startWear = wear;
    const startFuel = fuel;
    const startErs = ers;
    wear += g.wearGain;
    fuel -= g.burnKg;
    ers = Math.min(4, Math.max(0, ers + g.ersChangeMJ));
    return lap({
      lapNumber: n,
      completedAt: at,
      frame: at,
      actualCompound: 'C3',
      visualCompound: 'medium',
      tyreAgeAtStart: i,
      scShare: g.neutralised,
      inLap: g.inLap,
      outLap: g.outLap,
      wearAtStartPct: g.joined ? corners(unknown('notReceived')) : corners(known(startWear, at)),
      wearAtEndPct: corners(known(wear, at)),
      fuelAtStartKg: g.joined ? unknown('notReceived') : known(startFuel, at),
      fuelAtEndKg: known(fuel, at),
      ersStoreAtStartJ: g.joined ? unknown('notReceived') : known(startErs * MJ, at),
      ersStoreAtEndJ: known(ers * MJ, at),
    });
  });
}

const remaining: SessionRemaining = { basis: 'laps', lapsLeft: known(20, 0), timeLeftMs: unknown('notApplicable') };

/** The view after `laps`, the car on its stint's medium set (age = laps run) with the newest lap's wear, fuel and store. */
function viewOf(laps: LapRecord[]): EngineView {
  const last = laps.at(-1);
  const wear = last?.wearAtEndPct.fl.known === true ? last.wearAtEndPct.fl.value : 0;
  const fuel = last?.fuelAtEndKg.known === true ? last.fuelAtEndKg.value : 100;
  const ers = last?.ersStoreAtEndJ.known === true ? last.ersStoreAtEndJ.value : 2 * MJ;
  const car = carState({
    tyres: { actualCompound: 'C3', visualCompound: 'medium', age: laps.length, corners: corners({ wearPct: known(wear as Percent, 0) }), sets: liveSets([tyreSet('medium', { fitted: true, wearPct: wear })]) },
    energy: {
      fuel: known({ kg: fuel, capacityKg: 110, remainingLaps: 20, mix: 'standard' as const }, 0),
      ers: known({ storeJ: ers, mode: 'medium' as const, harvestedMgukJ: 0, harvestedMguhJ: 0, deployedJ: 0 }, 0),
    },
  });
  return situatedView({ cars: [car], history: { laps }, outputs: new Map([[SESSION_REMAINING, remaining]]), sessionTime: laps.length * 90_000 + 30_000 });
}

/** The three rates of car 0: the wear rate is tyre-model's medium rate at fl, with its source. */
const rates = (view: EngineView) => ({
  wear: tyreModelCalc.compute(view)[carId(0)]!.compounds.medium.wearRatePct.fl,
  fuel: fuelCalc.compute(view)[carId(0)]!.burnKgPerLap,
  ers: ersCalc.compute(view)[carId(0)]!.storeTrendJPerLap,
});

const stintArb = fc.array(genLap, { minLength: 0, maxLength: 9 });

describe('per-lap-gain rates: properties', () => {
  it('property: a lap under SC for 2 s or more never changes the wear or ERS rate, whatever its own samples', () => {
    fc.assert(
      fc.property(
        stintArb.filter((g) => g.some((l) => l.neutralised === 0.5)),
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -20, max: 20 }),
        (gen, wearShift, ersShift) => {
          const laps = lapsOf(gen);
          const changed = laps.map((l) =>
            l.scShare === 0.5
              ? {
                  ...l,
                  wearAtStartPct: corners(known(50 + wearShift, l.completedAt)),
                  ersStoreAtStartJ: known(2 * MJ + ersShift * 100_000, l.completedAt),
                }
              : l,
          );
          const a = rates(viewOf(laps));
          const b = rates(viewOf(changed));
          expect(b.wear).toEqual(a.wear);
          expect(b.ers).toEqual(a.ers);
        },
      ),
    );
  });

  it('property: a measured wear rate lies between the smallest and the largest gain of the counted laps; fewer than 3 counted laps give the prior', () => {
    fc.assert(
      fc.property(stintArb, (gen) => {
        const counted = gen.filter((g) => !g.inLap && !g.outLap && !g.joined && g.neutralised !== 0.5).map((g) => g.wearGain);
        const rate = rates(viewOf(lapsOf(gen))).wear;
        if (counted.length < 3) expect(rate.source).not.toBe('measured');
        if (rate.source !== 'measured') return;
        expect(rate.value.known).toBe(true);
        if (!rate.value.known) return;
        expect(rate.value.value).toBeGreaterThanOrEqual(Math.min(...counted));
        expect(rate.value.value).toBeLessThanOrEqual(Math.max(...counted));
      }),
    );
  });
});
