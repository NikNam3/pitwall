import fc from 'fast-check';
import type { SessionTime } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { isStale } from '../../src/kit/stale/stale.ts';

const T = (n: number) => n as SessionTime;

describe('isStale', () => {
  it('telemetry (menu rate) with cadence 50: 160 ms old is stale, 140 ms is not', () => {
    expect(isStale(T(1000), 'telemetry', T(1160), 50)).toBe(true);
    expect(isStale(T(1000), 'telemetry', T(1140), 50)).toBe(false);
  });

  it('damage (100 ms): 250 ms old is not stale, 301 ms is', () => {
    expect(isStale(T(1000), 'damage', T(1250), undefined)).toBe(false);
    expect(isStale(T(1000), 'damage', T(1301), undefined)).toBe(true);
  });

  it('a fixed-interval source ignores the cadence', () => {
    expect(isStale(T(1000), 'damage', T(1250), 1)).toBe(false);
  });

  it('a menu-rate source without cadence is never stale', () => {
    for (const source of ['lapData', 'motion', 'telemetry', 'status', 'motionEx'] as const) {
      expect(isStale(T(0), source, T(10_000_000), undefined)).toBe(false);
    }
  });

  it('a source never received (undefined updatedAt) is not stale', () => {
    expect(isStale(undefined, 'damage', T(10_000), undefined)).toBe(false);
    expect(isStale(undefined, 'telemetry', T(10_000), 50)).toBe(false);
  });

  it('the factor is a parameter: factor 5 on damage allows 500 ms', () => {
    expect(isStale(T(0), 'damage', T(500), undefined, 5)).toBe(false);
    expect(isStale(T(0), 'damage', T(501), undefined, 5)).toBe(true);
  });

  it('other fixed intervals: participants 5000 -> 15000 ms, setups 500 -> 1500 ms', () => {
    expect(isStale(T(0), 'participants', T(15_000), undefined)).toBe(false);
    expect(isStale(T(0), 'participants', T(15_001), undefined)).toBe(true);
    expect(isStale(T(0), 'setups', T(1500), undefined)).toBe(false);
    expect(isStale(T(0), 'setups', T(1501), undefined)).toBe(true);
  });

  it('is monotone in time: once stale, later is stale too', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 1, max: 500 }), (age, extra, cadence) => {
        if (isStale(T(0), 'telemetry', T(age), cadence)) expect(isStale(T(0), 'telemetry', T(age + extra), cadence)).toBe(true);
      }),
    );
  });
});
