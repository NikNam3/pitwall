import { carId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { ourCars } from '../../src/shared/our-cars.ts';

describe('ourCars', () => {
  it('the player car, then the teammate car', () => {
    expect(ourCars({ playerCar: carId(3), teammateCar: carId(7) })).toEqual([3, 7]);
  });

  it('only the player car without a teammate, or when the teammate is the player car', () => {
    expect(ourCars({ playerCar: carId(3) })).toEqual([3]);
    expect(ourCars({ playerCar: carId(3), teammateCar: undefined })).toEqual([3]);
    expect(ourCars({ playerCar: carId(3), teammateCar: carId(3) })).toEqual([3]);
  });
});
