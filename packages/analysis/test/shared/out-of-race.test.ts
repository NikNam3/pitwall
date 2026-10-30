// The one out-of-race set every analysis asks (wave 2, T7; situations plan Task 0): a car that will set no more times.
import type { ResultStatus } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { outOfRace } from '../../src/shared/out-of-race.ts';

const car = (resultStatus: ResultStatus) => ({ timing: { resultStatus } });

describe('outOfRace', () => {
  it.each(['retired', 'didNotFinish', 'disqualified', 'notClassified'] as const)('a %s car is out of the race', (resultStatus) => {
    expect(outOfRace(car(resultStatus))).toBe(true);
  });

  it.each(['invalid', 'inactive', 'active', 'finished'] as const)('a %s car is not', (resultStatus) => {
    expect(outOfRace(car(resultStatus))).toBe(false);
  });
});
