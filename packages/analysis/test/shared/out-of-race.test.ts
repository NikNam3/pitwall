// The one out-of-race rule every analysis asks (wave 2, T7; situations plan Task 0): a car that will set no more times.
// The statuses live in `@pitwall/domain` (`OUT_OF_RACE_STATUSES`, review 2, F6). The timing tower takes the answer from
// the lap board's `outOfRace` (review 3, U5), so this rule is the only reader of the statuses for that question.
import { OUT_OF_RACE_STATUSES, type ResultStatus } from '@pitwall/domain';
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

  it("asks the domain's out-of-race statuses: retired, did not finish, disqualified, not classified", () => {
    expect([...OUT_OF_RACE_STATUSES].sort()).toEqual(['didNotFinish', 'disqualified', 'notClassified', 'retired']);
    for (const resultStatus of OUT_OF_RACE_STATUSES) expect(outOfRace(car(resultStatus)), resultStatus).toBe(true);
  });
});
