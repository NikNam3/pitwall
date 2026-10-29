import fc from 'fast-check';
import type { SessionTime } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { carFieldStaleMs, isStale, staleRole } from '../../src/kit/stale/stale.ts';

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

describe('carFieldStaleMs', () => {
  it('is how much older the field\'s source is than the car\'s newest update, once it is stale', () => {
    expect(carFieldStaleMs({ telemetry: T(1000), lapData: T(1200) }, 'condition.brakes.tempC', 50)).toBe(200);
    expect(carFieldStaleMs({ damage: T(1000), telemetry: T(1301) }, 'tyres.corners.wearPct', undefined)).toBe(301);
  });
  it('is undefined while fresh, before the source arrived, without a cadence for a menu-rate source or without updatedAt', () => {
    expect(carFieldStaleMs({ telemetry: T(1000), lapData: T(1100) }, 'condition.brakes.tempC', 50)).toBeUndefined();
    expect(carFieldStaleMs({ lapData: T(5000) }, 'condition.brakes.tempC', 50)).toBeUndefined();
    expect(carFieldStaleMs({ telemetry: T(0), lapData: T(5000) }, 'condition.brakes.tempC', undefined)).toBeUndefined();
    expect(carFieldStaleMs(undefined, 'condition.brakes.tempC', 50)).toBeUndefined();
  });
  it('a car snapshot is judged by itself: every source as old as the newest is fresh, however old the snapshot (bug B2)', () => {
    expect(carFieldStaleMs({ telemetry: T(1000), lapData: T(1000), damage: T(1000) }, 'condition.brakes.tempC', 18)).toBeUndefined();
    expect(carFieldStaleMs({ telemetry: T(1000), lapData: T(1000), damage: T(1000) }, 'tyres.corners.wearPct', 18)).toBeUndefined();
  });
  it('at the rates measured on the TT Zandvoort recording no source of a steady car is stale', () => {
    // Session-time gaps there (p99 / max): menu rate 20 / 32 ms at an 18 ms cadence, damage 106 / 133, setups 506 / 508,
    // participants 5006 / 5007, tyre sets and session history 56 / 84.
    const newest = T(100_000);
    const updatedAt = { lapData: newest, telemetry: newest, motion: newest, status: newest, motionEx: newest,
      damage: T(100_000 - 133), setups: T(100_000 - 508), participants: T(100_000 - 5007), tyreSets: T(100_000 - 84), sessionHistory: T(100_000 - 84) };
    for (const field of ['tyres.corners.wearPct', 'condition.brakes.tempC', 'identity.teamId', 'tyres.sets', 'timing.lap'] as const) {
      expect(carFieldStaleMs(updatedAt, field, 18)).toBeUndefined();
    }
  });
});

describe('staleRole: stale wins over every highlight', () => {
  it('a stale value is faint whatever its role', () => {
    for (const r of ['critical', 'warning', 'textDim', undefined] as const) expect(staleRole(r, true)).toBe('textFaint');
  });
  it('a fresh value keeps its role, or none', () => {
    expect(staleRole('critical', false)).toBe('critical');
    expect(staleRole(undefined, false)).toBeUndefined();
  });
});
