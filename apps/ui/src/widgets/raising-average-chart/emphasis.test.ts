// The raising average's line look (spec 4, plan Task 9; C68): `lineLook(car, drawn, ours)` is the kit's `carColour` over
// the cars the chart draws. Our cars in the ownCar role, the teammate dashed; a rival in its team colour, solid unless a
// drawn car of its team with a lower race number is drawn too; a car of an unknown team textDim.
import { carId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { role, TEAM_COLOURS } from '../../theme/index.ts';
import { lineLook } from './emphasis.ts';

const KUH = { id: carId(0), teamId: 3, raceNumber: 7 };
const LIN = { id: carId(1), teamId: 3, raceNumber: 23 };
const LEC = { id: carId(6), teamId: 1, raceNumber: 16 };
const HAM = { id: carId(7), teamId: 1, raceNumber: 44 };
const RUS = { id: carId(8), teamId: 0, raceNumber: 63 };
const ours = new Set([KUH.id, LIN.id]);

describe('raising-average-chart: line look', () => {
  it('draws the player in ownCar, solid', () => {
    expect(lineLook(KUH, [KUH, LIN, HAM], ours)).toEqual({ colour: role('ownCar'), dashed: false, ownCar: true });
  });

  it('draws the teammate in ownCar, dashed', () => {
    expect(lineLook(LIN, [KUH, LIN, HAM], ours)).toEqual({ colour: role('ownCar'), dashed: true, ownCar: true });
  });

  it('draws a rival solid in its team colour when no other drawn car is of its team', () => {
    expect(lineLook(HAM, [KUH, LIN, HAM, RUS], ours)).toEqual({ colour: TEAM_COLOURS[1], dashed: false, ownCar: false });
    expect(lineLook(RUS, [KUH, LIN, HAM, RUS], ours)).toEqual({ colour: TEAM_COLOURS[0], dashed: false, ownCar: false });
  });

  it('dashes the second drawn rival of a team (the higher race number)', () => {
    expect(lineLook(HAM, [HAM, LEC], ours)).toEqual({ colour: TEAM_COLOURS[1], dashed: true, ownCar: false });
    expect(lineLook(LEC, [HAM, LEC], ours)).toEqual({ colour: TEAM_COLOURS[1], dashed: false, ownCar: false });
  });

  it('draws a car of an unknown team in textDim', () => {
    const other = { id: carId(19), teamId: 104, raceNumber: 2 };
    expect(lineLook(other, [other], ours)).toEqual({ colour: role('textDim'), dashed: false, ownCar: false });
  });
});
