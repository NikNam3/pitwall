// SP4.3c Task 17 fix round (R55; C43, C47): whether a car is driven by a human is one shared pure helper. A car-driver
// span decides; a car without one is the human's only when forecast-field's `unknownDriverIsHuman` says so. `rejoin`
// and `forecast-field` both call it, so they agree.
import { describe, expect, it } from 'vitest';
import { isHumanDriver } from '../../src/shared/human-driver.ts';

describe('isHumanDriver (R55)', () => {
  it.each([
    ['human', false, true],
    ['human', true, true],
    ['ai', false, false],
    ['ai', true, false],
    [undefined, false, false],
    [undefined, true, true],
  ] as const)('kind %s, unknownDriverIsHuman %s: %s', (kind, unknownDriverIsHuman, human) => {
    expect(isHumanDriver(kind, unknownDriverIsHuman)).toBe(human);
  });
});
