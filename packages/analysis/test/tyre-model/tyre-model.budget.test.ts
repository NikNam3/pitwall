// `tyre-model`'s budget (SP4.3c spec §7, plan Task 12 row 13): a quick calculator (no accumulator, C31) stays under 2 ms
// per frame on the long-race builder (70 laps, 20 cars) at lap 70, where the projection is largest. Every car carries a
// full allocation of 13 sets in the live state and in its laps' records, as the game sends them. The supervisor states the
// measured value, on an idle machine, in the run log.
import type { CarState, LapRecord, TyreSet } from '@pitwall/domain';
import { known } from '@pitwall/domain';
import type { EngineView, Projection } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { trackWetnessCalculator } from '../../src/track-wetness/calculator.ts';
import { TRACK_WETNESS } from '../../src/track-wetness/index.ts';
import { TYRE_MODEL, tyreModelCalculator } from '../../src/tyre-model/index.ts';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { tyreSet } from './support.ts';

/** Warm passes per frame; the best of them counts (docs/testing.md 6). */
const PASSES = 25;

/** A full allocation: the fitted set, then 4 soft, 4 medium, 3 hard and an inter (some used). */
const allocation = (fittedSoft: boolean): TyreSet[] => [
  tyreSet(fittedSoft ? 'soft' : 'medium', { fitted: true, wearPct: 30, lapDeltaMs: 0 }),
  ...Array.from({ length: 4 }, (_, i) => tyreSet('soft', { wearPct: i === 0 ? 20 : 0, lapDeltaMs: -600 })),
  ...Array.from({ length: 4 }, (_, i) => tyreSet('medium', { wearPct: i === 0 ? 12 : 0, lapDeltaMs: -900 })),
  ...Array.from({ length: 3 }, () => tyreSet('hard', { usableLifeLaps: 40, lapDeltaMs: -300 })),
  tyreSet('inter', { lapDeltaMs: 4_000 }),
];

/** The long race's view at `frame` with every car's sets and every lap's sets and carcass means. */
function withSets(view: EngineView): EngineView {
  const cars = (view.live.cars as unknown as CarState[]).map((c) => ({ ...c, tyres: { ...c.tyres, sets: known({ sets: allocation(c.tyres.visualCompound === 'soft'), fittedIdx: 0 }, 0) } }));
  const laps = (view.history.laps as unknown as LapRecord[]).map((l) => ({
    ...l,
    tyreSets: known(allocation(l.visualCompound === 'soft'), l.completedAt),
    carcassMeanC: { fl: known(90, l.completedAt), fr: known(91, l.completedAt), rl: known(92, l.completedAt), rr: known(93, l.completedAt) },
  }));
  return { ...view, live: { ...view.live, cars }, history: { ...(view.history as Projection), laps } };
}

describe('tyre-model budget', () => {
  it('long-race budget: under 2 ms per frame at lap 70', () => {
    const race = longRace();
    const views = race.framesOfLap(70).slice(0, 11).map((frame) => {
      const view = withSets(race.viewAt(frame));
      const outputs = new Map<string, unknown>();
      outputs.set(DEGRADATION, degradationCalculator.compute({ ...view, outputs }));
      outputs.set(TRACK_WETNESS, trackWetnessCalculator.compute({ ...view, outputs }));
      return { ...view, outputs };
    });
    expect(views.length).toBeGreaterThan(5);
    for (const view of views) tyreModelCalculator.compute(view); // warm
    const best = views.map((view) => {
      let ms = Infinity;
      for (let k = 0; k < PASSES; k++) {
        const start = performance.now();
        tyreModelCalculator.compute(view);
        ms = Math.min(ms, performance.now() - start);
      }
      return ms;
    });
    const median = [...best].sort((a, b) => a - b)[best.length >> 1]!;
    expect(median, `${TYRE_MODEL}: median best ms per frame`).toBeLessThan(2);
  });
});
