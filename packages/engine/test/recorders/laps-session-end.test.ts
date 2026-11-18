// A lap completes only at a crossing of the line (contract C10, C11, C25, C26, C43; SP4.3e Task 1, planner report §1):
// at an early session end the game raises a car's lap number without a crossing (the lap distance keeps rising) and
// sets `lastLapTimeInMs` to the car's sector-1 time; Session History then lists that lap with only sector 1, flagged
// valid. No lap is recorded for it, neither provisional nor confirmed. With a real crossing (the lap distance falls by
// more than half the track length) the lap is recorded as before.
import { describe, expect, it } from 'vitest';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
const entry = (lapTimeInMs: number, s1: number, s2: number, s3: number) => ({
  lapTimeInMs, sector1TimeMs: s1, sector2TimeMs: s2, sector3TimeMs: s3, lapValidBitFlags: 0b1111,
});

/**
 * Car 0 on lap 3 (5,000 m track), first seen at `beforeM`; the next frame lap 4 at `nowM` with `lastLapTimeInMs`
 * 26,974; then Session History lists lap 3 as `[26974, 0, 0]`, all valid (laps 1 and 2 are from before the engine saw
 * the car).
 */
const sessionEnd = (beforeM: number, nowM: number) => new ScenarioBuilder({ cars: 1 }).frames(4, (d) => {
  if (d.index <= 1) Object.assign(car0(d), { currentLapNum: 3, lapDistance: beforeM - 1 + d.index, currentLapTimeInMs: 52_000 + 341 * d.index, lastLapTimeInMs: 97_858, sector1TimeMs: 26_974 });
  else Object.assign(car0(d), { currentLapNum: 4, lapDistance: nowM + (d.index - 2), currentLapTimeInMs: 0, lastLapTimeInMs: 26_974, sector1TimeMs: 0, sector2TimeMs: 0 });
  if (d.index === 3) {
    d.add('sessionHistory', { carIdx: 0, numLaps: 4, lapHistoryData: [entry(97_000, 30_000, 33_000, 34_000), entry(97_858, 30_100, 33_200, 34_558), entry(26_974, 26_974, 0, 0)] });
  }
});

describe('laps: a lap completes only at a crossing of the line', () => {
  it('a lap number rise without a crossing (2,987 m → 2,988 m), then Session History [26974, 0, 0] valid: no lap 3, neither provisional nor confirmed', () => {
    const { st } = runScenario(sessionEnd(2_987, 2_988));
    expect(st.history.laps.filter((l) => l.carId === 0 && l.lapNumber === 3).map((l) => l.status)).toEqual([]);
  });
  it('the same with a real crossing (4,990 m → 10 m): lap 3 is recorded, provisional at the crossing, confirmed from Session History', () => {
    const { st } = runScenario(sessionEnd(4_990, 10));
    const lap3 = st.history.laps.filter((l) => l.carId === 0 && l.lapNumber === 3);
    expect(lap3.map((l) => [l.status, l.lapTimeMs])).toEqual([['provisional', 26_974], ['confirmed', 26_974]]);
    expect(lap3[1]!.sectorTimesMs).toEqual([26_974, 0, 0]);
    expect(lap3[1]!.frame).toBe(lap3[0]!.frame);
  });
});
