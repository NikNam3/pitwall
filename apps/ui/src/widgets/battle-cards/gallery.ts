// Gallery declaration of the battle-cards display (spec 9.1). Test-phase file: the implementer does not edit it.
import type { CarOverview } from '@pitwall/contracts';
import { carId, known, unknown } from '@pitwall/domain';
import type { BattleCard, BattleSide, Known, Moment, RaceMoment } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const k = <T>(value: T): Known<T> => known(value, 10);

const overview = (id: number, name: string): CarOverview =>
  ({ id: carId(id), identity: { name, raceNumber: id }, timing: {}, tyres: {}, updatedAt: 10 }) as unknown as CarOverview;
const cars = [overview(1, 'Kuhnlein'), overview(3, 'Charles Leclerc'), overview(7, 'Alexander Albon')];

// Mockup 2-timing.html: LEC ahead out of range, ALB behind already in DRS.
const lec: BattleSide = {
  carId: carId(3), gapMs: k(3199), closingMsPerLap: k(310), lapsToDrs: k(7.1), paceDeltaMs: k(290), overtakeMarginMs: k(-710),
  ours: { compound: 'medium', age: 12 }, theirs: { compound: 'hard', age: 23 }, theirErsStoreJ: k(3_100_000),
};
const alb: BattleSide = {
  carId: carId(7), gapMs: k(841), closingMsPerLap: k(220), lapsToDrs: k(0), paceDeltaMs: k(-420), overtakeMarginMs: k(-1420),
  ours: { compound: 'medium', age: 12 }, theirs: { compound: 'medium', age: 1 }, theirErsStoreJ: unknown('realism'),
};
const card: BattleCard = { carId: carId(1), ahead: k(lec), behind: k(alb) };

const moment = (name: Moment): Known<RaceMoment> =>
  k({ moment: name, since: unknown('notApplicable'), cause: { rule: name, params: { battleLaps: 2, drsRangeMs: 1000 } }, active: [name] });

/** Synthetic cases and fit expectations for `battle-cards`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceSingaporeStart.grid', 'raceSingaporeEnd.chequered'],
  cases: {
    neighbours: { card, cars, moment: undefined },
    // Mockup: in the battle moment the row in DRS range (ALB, behind) turns white bold.
    battleMoment: { card, cars, moment: moment('battle') },
    // Another moment: nothing lights up.
    carCareMoment: { card, cars, moment: moment('carCare') },
    // Realism: both rivals' ERS hidden, the cards still render.
    realismHidden: {
      card: { ...card, ahead: k({ ...lec, theirErsStoreJ: unknown('realism') }) },
      cars,
      moment: undefined,
    },
    // Race leader: nobody ahead.
    leader: { card: { ...card, ahead: unknown('notApplicable') }, cars, moment: undefined },
    // Linked car in realism mode: every value hidden.
    allHidden: { card: { carId: carId(1), ahead: unknown('realism'), behind: unknown('realism') }, cars, moment: undefined },
  },
  fit: [
    { mode: 'compact', cols: 26, rows: 3 },
    { mode: 'compact', cols: 48, rows: 3 },
    { mode: 'compact', cols: 69, rows: 5 },
    { mode: 'full', cols: 70, rows: 3 },
    { mode: 'full', cols: 90, rows: 6 },
  ],
};

export default gallery;
