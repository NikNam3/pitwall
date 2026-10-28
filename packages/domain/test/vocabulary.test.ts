import { describe, expect, it } from 'vitest';
import {
  actualCompoundFromCode,
  cornersFromGameOrder,
  driverKeyString,
  known,
  sessionUidString,
  toSessionTime,
  unknown,
  visualCompoundFromCode,
  type Known,
} from '../src/index.ts';

describe('Known', () => {
  it('known carries value and time, unknown carries the reason', () => {
    expect(known(42.5, 1200)).toEqual({ known: true, value: 42.5, at: 1200 });
    const r: Known<number> = unknown('restricted');
    expect(r).toEqual({ known: false, reason: 'restricted' });
  });
});

describe('cornersFromGameOrder', () => {
  it('maps game order RL, RR, FL, FR to named corners', () => {
    expect(cornersFromGameOrder(['rl', 'rr', 'fl', 'fr'] as const)).toEqual({ fl: 'fl', fr: 'fr', rl: 'rl', rr: 'rr' });
    expect(cornersFromGameOrder([1, 2, 3, 4] as const)).toEqual({ rl: 1, rr: 2, fl: 3, fr: 4 });
  });
});

describe('compounds (appendix codes)', () => {
  it.each([
    [16, 'C5'],
    [17, 'C4'],
    [18, 'C3'],
    [19, 'C2'],
    [20, 'C1'],
    [21, 'C0'],
    [22, 'C6'],
    [7, 'inter'],
    [8, 'wet'],
    [9, 'classicDry'],
    [10, 'classicWet'],
    [11, 'f2SuperSoft'],
    [12, 'f2Soft'],
    [13, 'f2Medium'],
    [14, 'f2Hard'],
    [15, 'f2Wet'],
    [0, 'unknown'],
    [255, 'unknown'],
  ] as const)('actual %i -> %s', (code, c) => expect(actualCompoundFromCode(code)).toBe(c));

  it.each([
    [16, 'soft'],
    [17, 'medium'],
    [18, 'hard'],
    [7, 'inter'],
    [8, 'wet'],
    [15, 'wet'],
    [19, 'superSoft'],
    [20, 'soft'],
    [21, 'medium'],
    [22, 'hard'],
    [0, 'unknown'],
    [9, 'unknown'],
  ] as const)('visual %i -> %s', (code, c) => expect(visualCompoundFromCode(code)).toBe(c));
});

describe('ids and units', () => {
  it('driverKeyString: AI by driverId, human by networkId + race number + name', () => {
    expect(driverKeyString({ kind: 'ai', driverId: 9 })).toBe('ai:9');
    expect(driverKeyString({ kind: 'human', networkId: 255, name: 'HAMILTON', raceNumber: 44 })).toBe(
      'human:255:44:HAMILTON',
    );
  });

  it('sessionUidString is the decimal u64', () =>
    expect(sessionUidString(0xb3cd07e2790bdcben)).toBe('12956020372289608894'));

  it('toSessionTime rounds seconds to integer ms', () => {
    expect(toSessionTime(12.3456)).toBe(12346);
    expect(toSessionTime(0)).toBe(0);
  });
});
