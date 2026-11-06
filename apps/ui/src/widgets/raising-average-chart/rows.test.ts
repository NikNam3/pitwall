// The raising average's lines (spec 4, plan Task 9; Task 0 answers Q2, Q3 A; C65, C68): `raisingSeries(analysis, cars,
// ours, rivals)` maps `raisingAverage.field` to the kit chart's series, mapping only. Contract assumed of `rows.ts`:
//  - `ours` is the ordered set of our cars (`kit/car/our-cars.ts`: the player, then the teammate); `rivals` the values of
//    the options `rival1`–`rival3` in that order (`CarRef | undefined`; unset is no car);
//  - our cars are always drawn, a rival only when an option names it; a car named twice, or an option naming one of
//    our cars (`player`, `teammate` or its id), draws no second line;
//  - the series: the named rivals in option order, then our cars (player, teammate), so ours are drawn on top;
//  - a car with an empty curve (no `forPace` lap) or without a curve draws nothing;
//  - a series: the car's code as label, point X at x = X with y = `pointsMs[X − 1]` as the analysis gives it, the
//    colour of `lineLook` (`emphasis.ts`) over the drawn cars;
//  - `axisLabels(mode)`: full names the axes `best n laps` and `mean lap`, compact names none.
import type { CarRef } from '@pitwall/contracts';
import type { CarId, RaisingAverage } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { ourCars } from '../../kit/car/our-cars.ts';
import { role, TEAM_COLOURS } from '../../theme/index.ts';
import { cases, curve, field, ID, points, raceCurves, raceOptions, sessionInfo } from './fixtures.ts';
import { axisLabels, raisingSeries } from './rows.ts';

const race = cases.race;
const ours = ourCars(race.session);
const RIVALS: Array<CarRef | undefined> = [raceOptions.rival1, raceOptions.rival2, raceOptions.rival3];
const NONE: Array<CarRef | undefined> = [undefined, undefined, undefined];

const labels = (analysis: RaisingAverage, rivals: Array<CarRef | undefined>, own: ReadonlySet<CarId> = ours): string[] =>
  raisingSeries(analysis, field, own, rivals).map((s) => s.label);

describe('raising-average-chart: which cars are drawn', () => {
  it('1. draws our two cars with every rival option unset, no other car', () => {
    expect(labels(race.analysis, NONE)).toEqual(['KUH', 'LIN']);
  });

  it('2. draws the rivals the options name, in option order, then our cars (the mockup: HAM, RUS, NOR, KUH, LIN)', () => {
    expect(labels(race.analysis, RIVALS)).toEqual(['HAM', 'RUS', 'NOR', 'KUH', 'LIN']);
  });

  it('3. draws a rival named by any one option, the others unset', () => {
    expect(labels(race.analysis, [undefined, undefined, ID.VER])).toEqual(['VER', 'KUH', 'LIN']);
    expect(labels(race.analysis, [ID.LEC, undefined, undefined])).toEqual(['LEC', 'KUH', 'LIN']);
  });

  it('4. draws a car named by two options once', () => {
    expect(labels(race.analysis, [ID.HAM, ID.HAM, ID.NOR])).toEqual(['HAM', 'NOR', 'KUH', 'LIN']);
  });

  it('5. draws no second line for an option naming one of our cars (player, teammate or its id)', () => {
    expect(labels(race.analysis, ['player', 'teammate', ID.KUH])).toEqual(['KUH', 'LIN']);
  });

  it('6. draws nothing for a car with an empty curve: a rival named by an option, or one of ours', () => {
    expect(labels(race.analysis, [ID.PIA, ID.HAM, undefined])).toEqual(['HAM', 'KUH', 'LIN']);
    const kuhEmpty = { cars: [curve(ID.KUH, []), raceCurves.LIN] };
    expect(labels(kuhEmpty, NONE)).toEqual(['LIN']);
  });

  it('7. draws nothing for a car without a curve (a rival named by an option, or our teammate)', () => {
    const onlyKuh = { cars: [raceCurves.KUH] };
    expect(labels(onlyKuh, [ID.HAM, undefined, undefined])).toEqual(['KUH']);
  });

  it('8. draws no line at all when every curve is empty (the no-laps case)', () => {
    expect(raisingSeries(cases.noLaps.analysis, field, ourCars(cases.noLaps.session), RIVALS)).toEqual([]);
  });

  it('9. draws the one car of the practice case: our player, no teammate', () => {
    const p = cases.practiceOneCar;
    expect(raisingSeries(p.analysis, p.cars, ourCars(p.session), NONE).map((s) => s.label)).toEqual(['KUH']);
  });

  it('10. without session.info has no car of ours: only the named rivals', () => {
    expect(labels(race.analysis, RIVALS, ourCars(undefined))).toEqual(['HAM', 'RUS', 'NOR']);
  });
});

describe('raising-average-chart: a line', () => {
  it('11. puts point X at x = X and y = the analysis\'s mean of the best X laps, unchanged', () => {
    const kuh = raisingSeries(race.analysis, field, ours, NONE).find((s) => s.label === 'KUH');
    const expected = points(18, 90_412, 20, 1.2).map((ms, i): [number, number] => [i + 1, ms]);
    expect(kuh?.points).toEqual(expected);
  });

  it('12. puts a one-lap curve at x = 1 only', () => {
    const one = { cars: [curve(ID.KUH, [90_412])] };
    expect(raisingSeries(one, field, ours, NONE)).toMatchObject([{ label: 'KUH', points: [[1, 90_412]] }]);
  });

  it('13. draws our player white (ownCar) and solid, the teammate white and dashed', () => {
    const s = raisingSeries(race.analysis, field, ours, RIVALS);
    expect(s.find((x) => x.label === 'KUH')?.colour).toEqual({ colour: role('ownCar'), dashed: false, ownCar: true });
    expect(s.find((x) => x.label === 'LIN')?.colour).toEqual({ colour: role('ownCar'), dashed: true, ownCar: true });
  });

  it('14. draws each rival in its team colour, solid (the mockup: HAM Ferrari, RUS Mercedes, NOR McLaren)', () => {
    const s = raisingSeries(race.analysis, field, ours, RIVALS);
    expect(s.find((x) => x.label === 'HAM')?.colour).toEqual({ colour: TEAM_COLOURS[1], dashed: false, ownCar: false });
    expect(s.find((x) => x.label === 'RUS')?.colour).toEqual({ colour: TEAM_COLOURS[0], dashed: false, ownCar: false });
    expect(s.find((x) => x.label === 'NOR')?.colour).toEqual({ colour: TEAM_COLOURS[8], dashed: false, ownCar: false });
  });

  it('15. dashes the second drawn rival of one team, judged over the drawn cars only', () => {
    // LEC (16) is in the field but not drawn: HAM (44) stays solid.
    const alone = raisingSeries(race.analysis, field, ours, [ID.HAM, undefined, undefined]);
    expect(alone.find((x) => x.label === 'HAM')?.colour?.dashed).toBe(false);
    const both = raisingSeries(race.analysis, field, ours, [ID.HAM, ID.LEC, undefined]);
    expect(both.find((x) => x.label === 'LEC')?.colour?.dashed).toBe(false);
    expect(both.find((x) => x.label === 'HAM')?.colour?.dashed).toBe(true);
  });

  it('16. ignores the order of the analysis\'s cars', () => {
    const reversed = { cars: [...race.analysis.cars].reverse() };
    expect(raisingSeries(reversed, field, ours, RIVALS)).toEqual(raisingSeries(race.analysis, field, ours, RIVALS));
  });

  it('17. resolves player and teammate options through our cars, not as rivals', () => {
    const swapped = ourCars(sessionInfo(ID.LIN, ID.KUH));
    const s = raisingSeries(race.analysis, field, swapped, ['player', undefined, undefined]);
    expect(s.map((x) => x.label)).toEqual(['LIN', 'KUH']);
    expect(s.find((x) => x.label === 'KUH')?.colour?.dashed).toBe(true);
  });
});

describe('raising-average-chart: the axes', () => {
  it('18. full names the x axis best n laps and the y axis mean lap', () => {
    expect(axisLabels('full')).toEqual({ x: ['best n laps'], y: ['mean lap'] });
  });

  it('19. compact names no axis', () => {
    expect(axisLabels('compact')).toEqual({ x: [''], y: [''] });
  });
});
