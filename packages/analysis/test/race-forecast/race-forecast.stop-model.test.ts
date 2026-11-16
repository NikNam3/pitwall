// SP4.3c Task 17 (O8, B8; C43, C50): one stop-and-rejoin model, `race-forecast`'s. `stopCostMs(start, car, condition)`
// is the whole time a stop costs car `car` under `condition`: the starting point's loss (its in-lap share and the rest
// together) less a human's shorter stationary time (500 ms). `stopperRejoin(start, car, condition, atLap)` is where car
// `car` rejoins when it stops at the end of lap `atLap`: its rejoin time T is its gap to the leader plus its stop cost;
// it rejoins behind every running car crossing before T, and yields to the first car that stayed out crossing in
// [T, T + minGapMs) (the pit-exit yield, once), rejoining `minGapMs` behind it. `gapAheadMs` and `gapBehindMs` are its
// gaps to the cars ahead of and behind it on the road there. A retired car is nobody's neighbour.
//
// These tests read a stop "now" (`atLap` = the car's start lap, `startLapOf`): the gaps are the starting point's.
import { createRng } from '@pitwall/engine/readers';
import type { Policy, StartingPoint } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { raceForecast, startLapOf, stopCostMs, stopperRejoin } from '../../src/race-forecast/index.ts';
import { interaction, PLAIN, startingPoint, type CarSpec } from './start.ts';

const LOSSES = { green: 21_000, vsc: 13_000, sc: 10_000, inLapShare: 0.4 };
const MIN_GAP_MS = 500;
const STOPPER = 1;

/**
 * Slot 0 leads; the stopper (slot 1) 2 s behind; slot 2 at 8 s, slot 3 at 20 s, slot 4 at 25 s, slot 5 retired at
 * 23.2 s (inside the yield window of a green stop: it must not count), slot 6 at 30 s. `over` replaces cars by slot.
 */
function field(over: Record<number, CarSpec> = {}, pitLossMs = LOSSES): StartingPoint {
  const cars: CarSpec[] = [{ gapMs: 0 }, { gapMs: 2_000 }, { gapMs: 8_000 }, { gapMs: 20_000 }, { gapMs: 25_000 }, { gapMs: 23_200, retired: true }, { gapMs: 30_000 }];
  for (const [slot, spec] of Object.entries(over)) cars[Number(slot)] = { ...cars[Number(slot)], ...spec };
  return startingPoint({ lap: 5, lapsTotal: 30, cars, pitLossMs, interaction: interaction({ minGapMs: MIN_GAP_MS }) });
}

const now = (start: StartingPoint, car = STOPPER): number => startLapOf(start, car);

describe('race-forecast: the stop cost (SP4.3c Task 17, O8)', () => {
  it("an AI car's stop costs the condition's whole loss, in-lap share and out-lap rest together", () => {
    const start = field();
    expect(stopCostMs(start, STOPPER, 'green')).toBe(21_000);
    expect(stopCostMs(start, STOPPER, 'vsc')).toBe(13_000);
    expect(stopCostMs(start, STOPPER, 'sc')).toBe(10_000);
    for (const inLapShare of [0, 1]) expect(stopCostMs(field({}, { ...LOSSES, inLapShare }), STOPPER, 'green')).toBe(21_000);
  });

  it("a human's stop costs 500 ms less under every condition", () => {
    const start = field({ [STOPPER]: { human: true } });
    expect(stopCostMs(start, STOPPER, 'green')).toBe(20_500);
    expect(stopCostMs(start, STOPPER, 'vsc')).toBe(12_500);
    expect(stopCostMs(start, STOPPER, 'sc')).toBe(9_500);
  });

  it('is what a stop costs in the forecast: a lone car stopping onto its own compound finishes stopCostMs later', () => {
    for (const human of [false, true]) {
      const start = startingPoint({ lap: 10, lapsTotal: 20, cars: [{ gapMs: 0, human }], pitLossMs: LOSSES, drsZones: [] });
      const stops: Policy = { stops: [{ lap: 12, compound: 'medium' }] };
      const stays: Policy = { stops: [] };
      const stopped = raceForecast(start, [stops], PLAIN, createRng(1)).raceTimeMs[0]!;
      const stayed = raceForecast(start, [stays], PLAIN, createRng(1)).raceTimeMs[0]!;
      expect(Math.abs(stopped - stayed - stopCostMs(start, 0, 'green')), `human ${human}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('race-forecast: the rejoin of a stopper (SP4.3c Task 17, O8)', () => {
  it('green, AI: behind every car crossing before gap + cost; the retired car in the yield window does not count', () => {
    const start = field();
    // T = 2 000 + 21 000 = 23 000: slots 0, 2, 3 ahead; slot 4 (25 000) behind
    expect(stopperRejoin(start, STOPPER, 'green', now(start))).toEqual({ position: 4, gapAheadMs: 3_000, gapBehindMs: 2_000 });
  });

  it("a human's rejoin uses its shorter stop", () => {
    const start = field({ [STOPPER]: { human: true } });
    expect(stopperRejoin(start, STOPPER, 'green', now(start))).toEqual({ position: 4, gapAheadMs: 2_500, gapBehindMs: 2_500 });
  });

  it("under the SC and the VSC: that condition's cost", () => {
    const start = field();
    // SC: T = 12 000 (slots 0, 2 ahead); VSC: T = 15 000
    expect(stopperRejoin(start, STOPPER, 'sc', now(start))).toEqual({ position: 3, gapAheadMs: 4_000, gapBehindMs: 8_000 });
    expect(stopperRejoin(start, STOPPER, 'vsc', now(start))).toEqual({ position: 3, gapAheadMs: 7_000, gapBehindMs: 5_000 });
  });

  it('the in-lap share moves no rejoin', () => {
    for (const inLapShare of [0, 1]) {
      const start = field({}, { ...LOSSES, inLapShare });
      expect(stopperRejoin(start, STOPPER, 'green', now(start)), `share ${inLapShare}`).toEqual({ position: 4, gapAheadMs: 3_000, gapBehindMs: 2_000 });
    }
  });

  it('the pit-exit yield: a car that stayed out crossing within minGapMs after T takes the place; the stopper rejoins minGapMs behind it', () => {
    // slot 4 at 23 300, in [23 000, 23 500): T' = 23 800, behind slot 4; slot 6 at 30 000 behind
    const start = field({ 4: { gapMs: 23_300 } });
    expect(stopperRejoin(start, STOPPER, 'green', now(start))).toEqual({ position: 5, gapAheadMs: MIN_GAP_MS, gapBehindMs: 6_200 });
  });

  it('it yields once: a second car inside the new window stays behind it', () => {
    // slot 4 yields the stopper to 23 800; slot 6 at 23 900 lies in [23 800, 24 300) and is not yielded to
    const start = field({ 4: { gapMs: 23_300 }, 6: { gapMs: 23_900 } });
    expect(stopperRejoin(start, STOPPER, 'green', now(start))).toEqual({ position: 5, gapAheadMs: MIN_GAP_MS, gapBehindMs: 100 });
  });
});
