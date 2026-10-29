import { describe, expect, it } from 'vitest';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import { lapsToLimitRole, WEAR_LAPS_WARNING } from './emphasis.ts';

const laps = (n: number) => known(n, toSessionTime(10));

describe('WEAR_LAPS_WARNING', () => {
  // No UI-reachable export of the alarms config (the UI may not import packages/analysis): the widget pins the
  // default of `wearLapsWarning` in packages/analysis/src/alarms/config.ts (3).
  it('mirrors the alarms default', () => {
    expect(WEAR_LAPS_WARNING).toBe(3);
  });
});

describe('lapsToLimitRole', () => {
  it('is critical below the threshold', () => {
    expect(lapsToLimitRole(laps(2), 3)).toBe('critical');
    expect(lapsToLimitRole(laps(0), 3)).toBe('critical');
  });

  it('is critical just below the threshold', () => {
    expect(lapsToLimitRole(laps(2.99), 3)).toBe('critical');
  });

  it('is undefined at the threshold', () => {
    expect(lapsToLimitRole(laps(3), 3)).toBeUndefined();
  });

  it('is undefined above the threshold', () => {
    expect(lapsToLimitRole(laps(37), 3)).toBeUndefined();
  });

  it('follows the threshold it is given', () => {
    expect(lapsToLimitRole(laps(4), 5)).toBe('critical');
    expect(lapsToLimitRole(laps(4), 3)).toBeUndefined();
  });

  it('is undefined for an unknown value, whatever the reason', () => {
    expect(lapsToLimitRole(unknown('insufficientData'), 3)).toBeUndefined();
    expect(lapsToLimitRole(unknown('realism'), 3)).toBeUndefined();
  });
});
