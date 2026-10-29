// The three-letter car code (spec A.4). Contract of `carCode(identity)` in src/kit/car/car-code.ts (pure):
//  - the first three letters of the name's last word, upper case;
//  - `#<raceNumber>` when the name is empty or whitespace.
// CarLabel props are `{ identity: Pick<CarIdentity, 'name' | 'raceNumber'>; ours: boolean }`.
import { describe, expect, it } from 'vitest';
import { carCode } from '../../src/kit/car/car-code.ts';

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
