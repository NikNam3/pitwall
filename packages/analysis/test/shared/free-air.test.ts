// Free-air laps (SP4.3a spec 5.1, 5.2, plan Task 9; C43): `freeAirLaps(history, gapMs)` gives the laps (`carId:lap`)
// at none of whose crossings another car was within `gapMs` ahead: it crossed the same mini-sector boundary less than
// `gapMs` before. `track-wetness` and `driver-noise` share it, so both judge free air alike.
//
// The probe: three cars over three 90 s laps, every lap's 50 crossings (`crossings`), car 0 leading, car 1 4 s behind,
// car 2 8 s behind. Each row moves one car closer at one crossing.
import { carId, type MiniSectorCrossing } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { crossings, history, lap } from '../../../../test-support/builders/index.ts';
import { freeAirLaps } from '../../src/shared/free-air.ts';

const LAP_MS = 90_000;
const START = 1_000;
const GAP_MS = 1_500;

/** Car `car`'s laps 1..3, `behindMs` behind the leader at every crossing. */
const carLaps = (car: number, behindMs: number): MiniSectorCrossing[] =>
  [1, 2, 3].flatMap((n) => crossings(carId(car), n, LAP_MS, START + behindMs + (n - 1) * LAP_MS));

/** The probe's crossings with `edit` applied to each, and the cars' lap records. */
function probe(edit: (c: MiniSectorCrossing) => MiniSectorCrossing = (c) => c, extra: MiniSectorCrossing[] = []) {
  const all = [...carLaps(0, 0), ...carLaps(1, 4_000), ...carLaps(2, 8_000), ...extra].map(edit).sort((a, b) => a.at - b.at);
  const laps = [0, 1, 2].flatMap((car) => [1, 2, 3].map((n) => lap({ carId: carId(car), lapNumber: n, lapTimeMs: LAP_MS, completedAt: START + car * 4_000 + n * LAP_MS })));
  return history({ crossings: all, laps });
}

/** Moves car `car`'s crossing of lap `n`, segment `segment`, to `aheadAt` + `gapMs`: that close behind the car ahead. */
const closeAt =
  (car: number, n: number, segment: number, behindOf: number, gapMs: number) =>
  (c: MiniSectorCrossing): MiniSectorCrossing =>
    c.carId === car && c.lap === n && c.segment === segment
      ? { ...c, at: START + behindOf * 4_000 + (n - 1) * LAP_MS + Math.round((segment * LAP_MS) / 50) + gapMs }
      : c;

const key = (car: number, n: number): string => `${carId(car)}:${n}`;

describe('freeAirLaps (C43)', () => {
  it('keys a lap carId:lap; with every car far apart every lap is free air', () => {
    const free = freeAirLaps(probe(), GAP_MS);
    for (const car of [0, 1, 2]) for (const n of [1, 2]) expect(free.has(key(car, n)), key(car, n)).toBe(true);
  });

  it('a car within the gap ahead at one crossing of the lap takes the whole lap out of free air', () => {
    // car 1 is 1 s behind car 0 at segment 25 of lap 2, 4 s at every other crossing
    const free = freeAirLaps(probe(closeAt(1, 2, 25, 0, 1_000)), GAP_MS);
    expect(free.has(key(1, 2))).toBe(false);
    expect(free.has(key(1, 1))).toBe(true);
  });

  it('a car close behind does not take the car ahead out of free air', () => {
    const free = freeAirLaps(probe(closeAt(1, 2, 25, 0, 1_000)), GAP_MS);
    expect(free.has(key(0, 2))).toBe(true);
  });

  it('the gap decides: 1.2 s ahead is free air at a 1 s gap, not at 1.5 s', () => {
    const history = probe(closeAt(2, 2, 10, 1, 1_200));
    expect(freeAirLaps(history, 1_500).has(key(2, 2))).toBe(false);
    expect(freeAirLaps(history, 1_000).has(key(2, 2))).toBe(true);
  });

  it('a lapped car ahead on the track counts as a car ahead', () => {
    // car 3, a lap down, crosses segment 10 0.8 s before car 0 does on its lap 2
    const backmarker: MiniSectorCrossing = { carId: carId(3), lap: 1, segment: 10, at: START + LAP_MS + Math.round((10 * LAP_MS) / 50) - 800, frame: 0 };
    const free = freeAirLaps(probe(undefined, [backmarker]), GAP_MS);
    expect(free.has(key(0, 2))).toBe(false);
    expect(free.has(key(0, 1))).toBe(true);
  });

  it('ahead is by crossing time at the crossing, not by the order on the lap before', () => {
    // car 1 crosses segment 30 of lap 2 0.5 s before car 0 does: there car 1 is ahead of car 0
    const free = freeAirLaps(probe(closeAt(1, 2, 30, 0, -500)), GAP_MS);
    expect(free.has(key(0, 2))).toBe(false);
  });
});
