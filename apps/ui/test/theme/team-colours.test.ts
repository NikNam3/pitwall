import { carId } from '@pitwall/domain';
import type { CarId } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../../src/theme/index.ts';
import { TEAM_COLOURS, carColour } from '../../src/theme/team-colours.ts';
import { deltaE100 } from './colour.ts';

type C = { id: CarId; teamId: number; raceNumber: number };
const car = (id: number, teamId: number, raceNumber: number): C => ({ id: carId(id), teamId, raceNumber });
const quiet = THEMES.find((t) => t.name === 'quiet')!.roles;
// The role colours may be returned as the quiet value or as the CSS variable reference.
const textDim = [quiet.textDim, 'var(--pw-textDim)'];
const ownRole = [quiet.ownCar, 'var(--pw-ownCar)'];

describe('TEAM_COLOURS', () => {
  it('covers team ids 0 to 9 with the approved colours', () => {
    expect(Object.keys(TEAM_COLOURS).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(TEAM_COLOURS[0]).toBe('#00a7af');
    expect(TEAM_COLOURS[1]).toBe('#c13b43');
    expect(TEAM_COLOURS[9]).toBe('#78d062');
  });

  it('every pair is at least 19 OKLab deltaE x 100 apart', () => {
    const ids = Object.keys(TEAM_COLOURS).map(Number);
    for (const a of ids) for (const b of ids) {
      if (a < b) expect(deltaE100(TEAM_COLOURS[a]!, TEAM_COLOURS[b]!), `${a} vs ${b}`).toBeGreaterThanOrEqual(19);
    }
  });
});

describe('carColour', () => {
  const field = [car(0, 1, 16), car(1, 1, 44), car(2, 0, 63), car(3, 0, 12), car(4, 99, 7)];
  const none = new Set<CarId>();

  it('teammates share the team colour; lower race number solid, the other dashed', () => {
    const a = carColour(field[0]!, field, none);
    const b = carColour(field[1]!, field, none);
    expect(a.colour).toBe(TEAM_COLOURS[1]);
    expect(b.colour).toBe(TEAM_COLOURS[1]);
    expect(a.dashed).toBe(false);
    expect(b.dashed).toBe(true);
    expect(a.ownCar).toBe(false);
    expect(carColour(field[3]!, field, none).dashed).toBe(false);
    expect(carColour(field[2]!, field, none).dashed).toBe(true);
  });

  it('own cars are ownCar: the player solid, the teammate dashed', () => {
    const own = new Set([field[0]!.id, field[1]!.id]);
    // player is the first own car in the set
    const player = carColour(field[0]!, field, own);
    const mate = carColour(field[1]!, field, own);
    expect(player).toMatchObject({ ownCar: true, dashed: false });
    expect(mate).toMatchObject({ ownCar: true, dashed: true });
    expect(player.colour).toBe(mate.colour);
    expect(player.colour).not.toBe(TEAM_COLOURS[1]);
    expect(ownRole).toContain(player.colour);
  });

  it('an unknown team gets textDim, solid', () => {
    const r = carColour(field[4]!, field, none);
    expect(textDim).toContain(r.colour);
    expect(r).toMatchObject({ dashed: false, ownCar: false });
  });

  it('a lone car of a known team is solid in the team colour', () => {
    const solo = car(5, 8, 4);
    expect(carColour(solo, [solo], none)).toEqual({ colour: TEAM_COLOURS[8], dashed: false, ownCar: false });
  });

  it('gives the same result whatever the order of field', () => {
    const arbCar = fc.record({ teamId: fc.integer({ min: 0, max: 11 }), raceNumber: fc.integer({ min: 1, max: 99 }) });
    fc.assert(
      fc.property(
        fc.array(arbCar, { minLength: 2, maxLength: 20 }).map((cs) => cs.map((c, i) => car(i, c.teamId, c.raceNumber))),
        fc.integer({ min: 0, max: 3 }),
        fc.infiniteStream(fc.nat()),
        (cars, ownCount, rnd) => {
          const own = new Set(cars.slice(0, ownCount).map((c) => c.id));
          const shuffled = [...cars].sort(() => 0);
          const it = rnd[Symbol.iterator]();
          shuffled.sort(() => (it.next().value as number) % 3 - 1);
          for (const c of cars) expect(carColour(c, shuffled, own)).toEqual(carColour(c, cars, own));
        },
      ),
    );
  });
});
