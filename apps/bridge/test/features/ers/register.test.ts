import { ERS, ERS_CONFIG, type ErsOutput } from '@pitwall/analysis';
import { carId, type ErsState } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import ers from '../../../src/features/ers/register.ts';

const hidden = { known: false, reason: 'realism' } as const;
const value = (storeTrendJPerLap: number): ErsState => ({
  storeJ: hidden,
  capacityJ: 4_000_000,
  deployedThisLapJ: hidden,
  deployLimitJ: 4_000_000,
  harvestedThisLapJ: hidden,
  storeTrendJPerLap: { known: true, value: storeTrendJPerLap, at: 0 },
  attackLevelJ: 2_400_000,
  lapsToAttackLevel: hidden,
  attack: hidden,
  mode: hidden,
  flow: hidden,
});

describe('ers feature', () => {
  it('registers the calculator, its config and the topic ers.car', () => {
    expect(ers.name).toBe('ers');
    expect(ers.calculators.map((c) => c.id)).toEqual([ERS]);
    expect(ers.config).toEqual([ERS_CONFIG]);
    expect(ers.topics).toHaveLength(1);
    expect(ers.topics[0]).toMatchObject({ topic: 'ers.car', from: ERS });
  });

  it('select returns the value for params.carId and undefined for an unknown car', () => {
    const out: ErsOutput = { [carId(0)]: value(-1), [carId(3)]: value(-3) };
    const binding = ers.topics[0] as unknown as { select: (out: unknown, params: object) => unknown };
    expect(binding.select(out, { carId: 3 })).toEqual(value(-3));
    expect(binding.select(out, { carId: 0 })).toEqual(value(-1));
    expect(binding.select(out, { carId: 7 })).toBeUndefined();
    expect(binding.select(out, { carId: 99 })).toBeUndefined();
    expect(binding.select(out, {})).toBeUndefined();
  });
});
