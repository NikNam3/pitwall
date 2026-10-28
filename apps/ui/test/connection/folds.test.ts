import { addLaps, carId, emptyCurrentLaps, unknown, type LapRecord } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { lapsFold } from '../../src/kit/folds.ts';

const lap = (n: number, status: LapRecord['status']): LapRecord => ({
  carId: carId(0),
  lapNumber: n,
  lapTimeMs: 70_000,
  sectorTimesMs: [20_000, 25_000, 25_000],
  valid: { lap: true, sectors: [true, true, true] },
  actualCompound: 'C4',
  visualCompound: 'soft',
  tyreAgeAtStart: 0,
  fuelAtStartKg: unknown('notReceived'),
  fuelAtEndKg: unknown('notReceived'),
  scShare: 0,
  vscShare: 0,
  inLap: false,
  outLap: false,
  positionAtEnd: 1,
  status,
  completedAt: n * 70_000,
});

describe('lapsFold', () => {
  it('init is an empty collection, and each init is a fresh one', () => {
    expect(lapsFold.init()).toEqual(emptyCurrentLaps());
    expect(lapsFold.init()).not.toBe(lapsFold.init());
  });

  it('add applies laps like addLaps', () => {
    const laps = [lap(1, 'provisional'), lap(1, 'confirmed'), lap(2, 'provisional')];
    expect(lapsFold.add(lapsFold.init(), laps)).toEqual(addLaps(emptyCurrentLaps(), laps));
  });
});
