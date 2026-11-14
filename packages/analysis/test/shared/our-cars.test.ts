// Our cars, one definition (SP4.3c Task 1, spec §5.3; C43): `ourCars` is the domain helper; the player's car first,
// then the teammate once when it is a different car. `analysis/src/shared/our-cars.ts` is deleted. Belongs in
// `packages/domain/test/our-cars.test.ts` (this worker's hooks could not write `packages/domain/test`).
import { carId, ourCars } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';

describe('ourCars', () => {
  it('the player car, then the teammate car', () => {
    expect(ourCars({ playerCar: carId(19), teammateCar: carId(7) })).toEqual([19, 7]);
  });

  it('only the player car without a teammate', () => {
    expect(ourCars({ playerCar: carId(19) })).toEqual([19]);
    expect(ourCars({ playerCar: carId(19), teammateCar: undefined })).toEqual([19]);
  });

  it('a teammate that is the player car counts once', () => {
    expect(ourCars({ playerCar: carId(19), teammateCar: carId(19) })).toEqual([19]);
  });
});
