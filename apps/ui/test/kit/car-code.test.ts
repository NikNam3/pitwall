// The three-letter car code (spec A.4). Contract of `carCode(identity)` in src/kit/car/car-code.ts (pure):
//  - the first three letters of the name's last word, upper case;
//  - `#<raceNumber>` when the name is empty or whitespace.
// `carCodeById(cars, id)` is the code as a cell, empty with `notReceived` for a car not in the field; `ourCars(session)`
// is the ordered set player, teammate.
// CarLabel props are `{ identity: Pick<CarIdentity, 'name' | 'raceNumber'>; ours: boolean }`.
import { describe, expect, it } from 'vitest';
import { carId } from '@pitwall/domain';
import { carCode } from '../../src/kit/car/car-code.ts';
import { carCodeById } from '../../src/kit/car/car-label.ts';
import { ourCars } from '../../src/kit/car/our-cars.ts';

describe('carCode', () => {
  it('uses the last word of a full name', () => {
    expect(carCode({ name: 'Max Verstappen', raceNumber: 1 })).toBe('VER');
  });
  it('upper-cases a name already in capitals', () => {
    expect(carCode({ name: 'VERSTAPPEN', raceNumber: 1 })).toBe('VER');
  });
  it('uses the last word of a name with a prefix', () => {
    expect(carCode({ name: 'de Vries', raceNumber: 21 })).toBe('VRI');
  });
  it('keeps a short last word whole', () => {
    expect(carCode({ name: 'Li', raceNumber: 5 })).toBe('LI');
  });
  it('falls back to the race number for an empty or blank name', () => {
    expect(carCode({ name: '', raceNumber: 44 })).toBe('#44');
    expect(carCode({ name: '   ', raceNumber: 7 })).toBe('#7');
  });
});

describe('carCodeById', () => {
  const cars = [{ id: 3, identity: { name: 'Charles Leclerc', raceNumber: 16 } }];
  it("is the code of the car with that id", () => {
    expect(carCodeById(cars, 3)).toEqual({ text: 'LEC' });
  });
  it('is empty with notReceived for a car the field lacks: one fallback, the reason on hover', () => {
    expect(carCodeById(cars, 7)).toEqual({ text: '', reason: 'notReceived' });
  });
});

describe('ourCars', () => {
  it('is the player, then the teammate, in that order', () => {
    expect([...ourCars({ playerCar: carId(4), teammateCar: carId(9) })]).toEqual([4, 9]);
  });
  it('is the player alone without a teammate', () => {
    expect([...ourCars({ playerCar: carId(4) })]).toEqual([4]);
  });
  it('is empty without a session', () => {
    expect([...ourCars(undefined)]).toEqual([]);
  });
});
