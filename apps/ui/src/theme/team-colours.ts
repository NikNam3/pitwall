import type { CarId } from '@pitwall/domain';
import { role } from './roles.ts';

/** One colour per F1 25 team id, the same in every chart and session. */
export const TEAM_COLOURS: Readonly<Record<number, string>> = {
  0: '#00a7af', // Mercedes
  1: '#c13b43', // Ferrari
  2: '#cfb2ff', // Red Bull Racing
  3: '#3b6bd4', // Williams
  4: '#348705', // Aston Martin
  5: '#bc64c8', // Alpine
  6: '#00e7ff', // RB
  7: '#bf8800', // Haas
  8: '#febf84', // McLaren
  9: '#78d062', // Sauber
};

/** Set whose insertion order matters: player first, then teammate. */
export type OrderedOwnCars = ReadonlySet<CarId>;

type CarKey = { id: CarId; teamId: number; raceNumber: number };

/** True when `a` sorts before `b` in the team: lower race number, then lower id. */
const before = (a: CarKey, b: CarKey): boolean =>
  a.raceNumber !== b.raceNumber ? a.raceNumber < b.raceNumber : a.id < b.id;

/**
 * The only source of a car's chart colour. Own cars are `ownCar` (the first car of
 * `ownCars` is the player: solid; the others dashed). Other cars take the team colour,
 * solid for the team's lowest race number and dashed for the rest. An unknown team is
 * `textDim`. Independent of the order of `field`.
 *
 * @param ownCars ORDERED set: the player first, then the teammate. Insertion order is the contract.
 */
export function carColour(
  car: CarKey,
  field: ReadonlyArray<CarKey>,
  ownCars: OrderedOwnCars,
): { colour: string; dashed: boolean; ownCar: boolean } {
  if (ownCars.has(car.id)) {
    const player = ownCars.values().next().value;
    return { colour: role('ownCar'), dashed: car.id !== player, ownCar: true };
  }
  const colour = TEAM_COLOURS[car.teamId];
  if (colour === undefined) return { colour: role('textDim'), dashed: false, ownCar: false };
  const dashed = field.some((o) => o.id !== car.id && o.teamId === car.teamId && before(o, car));
  return { colour, dashed, ownCar: false };
}
