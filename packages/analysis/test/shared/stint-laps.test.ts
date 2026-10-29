import { carId, type LapRecord, type StintRecord } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { currentStintLaps, stintLaps } from '../../src/shared/stint-laps.ts';
import { history, lap } from '../../../../test-support/builders/index.ts';
import { engineShaped } from '../engine-shaped.ts';

const stint = (firstLap: number, lastLap: number, car = 0): StintRecord => ({
  carId: carId(car),
  firstLap,
  lastLap,
  actualCompound: 'C3',
  visualCompound: 'soft',
  tyreAgeAtFitting: 0,
});

const laps = (from: number, to: number, over: Partial<LapRecord> = {}): LapRecord[] =>
  Array.from({ length: to - from + 1 }, (_, i) => lap({ lapNumber: from + i, ...over }));

const numbers = (list: readonly { lapNumber: number }[]) => list.map((l) => l.lapNumber);

describe('stintLaps', () => {
  it('without a stint record the whole history is one stint', () => {
    expect(numbers(stintLaps(laps(1, 4), undefined))).toEqual([1, 2, 3, 4]);
  });

  it('the engine writes a record only when a stint closes: the open stint starts after the last record', () => {
    expect(numbers(stintLaps(laps(1, 7), stint(1, 4)))).toEqual([5, 6, 7]);
  });

  it('a record that reaches the newest lap (the session ended) is the current stint', () => {
    expect(numbers(stintLaps(laps(1, 7), stint(5, 7)))).toEqual([5, 6, 7]);
  });

  it('a record that reaches or passes the newest lap (a stop before the in lap ends) is still the current stint', () => {
    expect(numbers(stintLaps(laps(1, 5), stint(1, 5)))).toEqual([1, 2, 3, 4, 5]);
    expect(numbers(stintLaps(laps(1, 4), stint(1, 5)))).toEqual([1, 2, 3, 4]);
  });
});

describe('currentStintLaps', () => {
  it('closed stint 1 and the laps of the open stint 2, as the engine writes them: one confirmed record per lap of stint 2', () => {
    const h = history({ laps: engineShaped(laps(1, 7), { lapTimeMs: 99_000 }), stints: [stint(1, 4)] });
    const result = currentStintLaps(h, carId(0));
    expect(numbers(result)).toEqual([5, 6, 7]);
    expect(result.every((l) => l.status === 'confirmed' && l.lapTimeMs === 90_000)).toBe(true);
  });

  it('a lap still provisional counts with its provisional record', () => {
    const h = history({ laps: [...engineShaped(laps(1, 2)), lap({ lapNumber: 3, status: 'provisional' })] });
    expect(currentStintLaps(h, carId(0)).map((l) => [l.lapNumber, l.status])).toEqual([
      [1, 'confirmed'],
      [2, 'confirmed'],
      [3, 'provisional'],
    ]);
  });

  it('sorts by lap number and keeps to the car, its own laps and its own stints', () => {
    const h = history({
      laps: [...laps(3, 4).reverse(), ...laps(1, 2), ...laps(1, 6, { carId: carId(2) })],
      stints: [stint(1, 1), stint(1, 5, 2)],
    });
    expect(numbers(currentStintLaps(h, carId(0)))).toEqual([2, 3, 4]);
    expect(numbers(currentStintLaps(h, carId(2)))).toEqual([6]);
    expect(currentStintLaps(h, carId(7))).toEqual([]);
  });

  it('the last record of the car in history order is its last stint', () => {
    const h = history({ laps: laps(1, 9), stints: [stint(1, 3), stint(4, 6)] });
    expect(numbers(currentStintLaps(h, carId(0)))).toEqual([7, 8, 9]);
  });
});
