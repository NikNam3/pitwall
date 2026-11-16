// SP4.3c Task 17 (O8; C43, C50): the DP prices a stop with the one stop model, `race-forecast`'s `stopCostMs`; it keeps
// no loss arithmetic of its own. Its cost of a stop at the end of lap offset i under a condition is `stopCostMs` of the
// starting point plus the lap's traffic (the world's, SP4.3c Task 19); the traffic cost of a rejoin (`trafficOf`)
// measures from the rejoin time the same model gives (the car's gap plus `stopCostMs`), so a human's shorter stop
// rejoins 500 ms earlier.
import { carId, unknown, type StartingPoint } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { startLapOf, stopCostMs } from '../../src/race-forecast/index.ts';
import { dpInputOn, hazardOf, plannedField, type PlainRoad } from '../../src/shared/strategy-input/dp-input.ts';
import { COND_SC, COND_VSC, stopCostMs as dpStopCostMs } from '../../src/strategy-dp/state.ts';
import { startingPoint } from '../race-forecast/start.ts';
import { oneWorld } from '../shared/strategy-input/worlds.ts';

const CAR = carId(1);
const LOSSES = { green: 21_000, vsc: 13_000, sc: 10_000, inLapShare: 0.4 };
const TRAFFIC_GAP_MS = 2_000;

/** Slot 0 leads, our car (slot 1, human or not) 2 s behind, slot 2 at 22 s: 1 s ahead of an AI rejoin, 0.5 s ahead of a human one. */
function fieldOf(human: boolean): StartingPoint {
  const start = startingPoint({ lap: 5, lapsTotal: 20, ours: [CAR], cars: [{ gapMs: 0 }, { gapMs: 2_000, human }, { gapMs: 22_000 }], pitLossMs: LOSSES });
  return plannedField(start, [CAR]);
}

/** A plain road with every lap from `fromLap` at the starting point's gaps. */
function roadOf(start: StartingPoint, fromLap: number): PlainRoad {
  const road: PlainRoad = new Map();
  for (let lap = fromLap; lap <= start.lapsTotal; lap++) road.set(lap, { gapMs: Float64Array.from(start.gapMs), position: Int8Array.from([1, 2, 3]) });
  return road;
}

const inputOf = (start: StartingPoint, road: PlainRoad = new Map()) => dpInputOn(start, CAR, hazardOf(start, unknown('notReceived')), oneWorld(start, road), TRAFFIC_GAP_MS);

describe('strategy-dp: the stop cost is the one stop model (SP4.3c Task 17, O8)', () => {
  it("the DP's cost of a stop under each condition equals stopCostMs, plus the lap's traffic", () => {
    for (const human of [false, true]) {
      const start = fieldOf(human);
      const input = inputOf(start);
      const n = input.totalLaps - input.fromLap + 1;
      for (let i = 0; i < n; i++) {
        const traffic = input.worlds[0]!.trafficMsByLap[i] ?? 0;
        expect(dpStopCostMs(input, 0, i), `human ${human}, green, offset ${i}`).toBe(stopCostMs(start, CAR, 'green') + traffic);
        expect(dpStopCostMs(input, COND_SC, i), `human ${human}, SC, offset ${i}`).toBe(stopCostMs(start, CAR, 'sc') + traffic);
        expect(dpStopCostMs(input, COND_VSC, i), `human ${human}, VSC, offset ${i}`).toBe(stopCostMs(start, CAR, 'vsc') + traffic);
      }
    }
  });

  it("the traffic cost measures from the model's rejoin time: a human rejoins 500 ms earlier, closer to the car ahead", () => {
    for (const [human, expected] of [
      // AI: rejoin 2 000 + 21 000 = 23 000, slot 2 1 000 ahead: 2 000 − 1 000
      [false, 1_000],
      // human: rejoin 22 500, slot 2 500 ahead: 2 000 − 500
      [true, 1_500],
    ] as const) {
      const start = fieldOf(human);
      const fromLap = startLapOf(start, CAR);
      const input = inputOf(start, roadOf(start, fromLap));
      expect(input.worlds[0]!.trafficMsByLap[0], `human ${human}`).toBe(expected);
    }
  });
});
