import { carId } from '@pitwall/domain';
import type { DamageOutput } from '@pitwall/analysis';
import { describe, expect, it } from 'vitest';
import damage from '../../../src/features/damage/register.ts';

const state = { parts: { known: false, reason: 'realism' }, jumps: [] } as unknown as DamageOutput[number];

describe('damage feature', () => {
  it('registers the calculator damage, the config section damage and the topic damage.car', () => {
    expect(damage.name).toBe('damage');
    expect(damage.calculators.map((c) => c.id)).toEqual(['damage']);
    expect(damage.config?.map((c) => c.key)).toEqual(['damage']);
    expect(damage.topics).toHaveLength(1);
    expect(damage.topics[0]).toMatchObject({ topic: 'damage.car', from: 'damage' });
  });

  it('select returns the value for params.carId and undefined for an unknown car', () => {
    const binding = damage.topics[0] as unknown as { select: (out: unknown, params: object) => unknown };
    const out: DamageOutput = { [carId(3)]: state };
    expect(binding.select(out, { carId: 3 })).toEqual(state);
    expect(binding.select(out, { carId: 4 })).toBeUndefined();
  });
});
