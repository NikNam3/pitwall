import { TYRE_WEAR, TYRE_WEAR_CONFIG, type TyreWearOutput } from '@pitwall/analysis';
import { carId, type TyreWear } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import tyreWear from '../../../src/features/tyre-wear/register.ts';

const value = (limitPct: number): TyreWear => ({
  corners: {
    fl: { wearPct: { known: false, reason: 'realism' }, ratePctPerLap: { known: false, reason: 'realism' }, lapsToLimit: { known: false, reason: 'realism' } },
    fr: { wearPct: { known: false, reason: 'realism' }, ratePctPerLap: { known: false, reason: 'realism' }, lapsToLimit: { known: false, reason: 'realism' } },
    rl: { wearPct: { known: false, reason: 'realism' }, ratePctPerLap: { known: false, reason: 'realism' }, lapsToLimit: { known: false, reason: 'realism' } },
    rr: { wearPct: { known: false, reason: 'realism' }, ratePctPerLap: { known: false, reason: 'realism' }, lapsToLimit: { known: false, reason: 'realism' } },
  },
  limitPct,
  warnLaps: 3,
  gameLifeSpanLaps: { known: false, reason: 'realism' },
});

describe('tyre-wear feature', () => {
  it('registers the calculator, its config and the topic tyreWear.car', () => {
    expect(tyreWear.name).toBe('tyre-wear');
    expect(tyreWear.calculators.map((c) => c.id)).toEqual([TYRE_WEAR]);
    expect(tyreWear.config).toEqual([TYRE_WEAR_CONFIG]);
    expect(tyreWear.topics).toHaveLength(1);
    expect(tyreWear.topics[0]).toMatchObject({ topic: 'tyreWear.car', from: TYRE_WEAR });
  });

  it('select returns the value for params.carId and undefined for an unknown car', () => {
    const out: TyreWearOutput = { [carId(0)]: value(70), [carId(3)]: value(75) };
    const binding = tyreWear.topics[0] as unknown as { select: (out: unknown, params: object) => unknown };
    expect(binding.select(out, { carId: 3 })).toEqual(value(75));
    expect(binding.select(out, { carId: 0 })).toEqual(value(70));
    expect(binding.select(out, { carId: 7 })).toBeUndefined();
    expect(binding.select(out, { carId: 99 })).toBeUndefined();
    expect(binding.select(out, {})).toBeUndefined();
  });
});
