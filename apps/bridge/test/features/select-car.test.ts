// The one per-car select of the features whose calculator output is keyed by car id (battle, car-bands, damage, ers, fuel, tyre-wear).
import type { CarId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { selectCar } from '../../src/features/feature.ts';

const out = { 0: 'car 0', 19: 'car 19' } as unknown as Record<CarId, string>;

describe('selectCar', () => {
  it('picks the entry of the car params.carId names', () => {
    expect(selectCar(out, { carId: 19 })).toBe('car 19');
    expect(selectCar(out, { carId: 0 })).toBe('car 0');
  });

  it('is undefined for a car the output does not have', () => {
    expect(selectCar(out, { carId: 5 })).toBeUndefined();
  });

  it('is undefined for params that do not name a car: no carId, an inherited one, a string, a fraction', () => {
    expect(selectCar(out, {})).toBeUndefined();
    expect(selectCar(out, Object.create({ carId: 0 }) as object)).toBeUndefined();
    expect(selectCar(out, { carId: '0' })).toBeUndefined();
    expect(selectCar(out, { carId: 0.5 })).toBeUndefined();
  });

  it('never reads an inherited property of the output', () => {
    expect(selectCar({} as Record<CarId, unknown>, { carId: 0 })).toBeUndefined();
  });
});
