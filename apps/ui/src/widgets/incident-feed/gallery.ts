// Gallery declaration of the incident-feed display (spec 9.1). Test-phase file: the implementer does not edit it.
import type { CarOverview } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { IncidentEntry, Known, Moment, RaceMoment } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const k = <T>(value: T): Known<T> => known(value, 10);

const overview = (id: number, name: string): CarOverview =>
  ({ id: carId(id), identity: { name, raceNumber: id }, timing: {}, tyres: {}, updatedAt: 10 }) as unknown as CarOverview;
const cars = [overview(1, 'Kuhnlein'), overview(2, 'Esteban Ocon'), overview(3, 'Carlos Sainz'), overview(4, 'Alexander Albon'), overview(5, 'Oscar Piastri')];

// Mockup 2-timing.html, newest first. Car 1 is ours.
const collision: IncidentEntry = {
  id: 'collision:2+3:230000', at: toSessionTime(230_000), lap: 23, kind: 'collision', severity: 'major', carIds: [carId(2), carId(3)],
  timeLostMs: k(4200),
  forUs: [{ ourCarId: carId(1), positionBefore: 5, positionAfter: k(4), gapBeforeMs: k(4100), gapAfterMs: unknown('notApplicable') }],
};
const timeLoss: IncidentEntry = {
  id: 'timeLoss:4:220000', at: toSessionTime(220_000), lap: 22, kind: 'timeLoss', severity: 'major', carIds: [carId(4)],
  timeLostMs: k(6100),
  forUs: [{ ourCarId: carId(1), positionBefore: 5, positionAfter: k(5), gapBeforeMs: k(-1900), gapAfterMs: k(5800) }],
};
const warning: IncidentEntry = {
  id: 'warning:5:210000', at: toSessionTime(210_000), lap: 21, kind: 'warning', severity: 'minor', carIds: [carId(5)],
  timeLostMs: unknown('notApplicable'), forUs: [],
};
const neutralised: IncidentEntry = {
  id: 'neutralised::190000', at: toSessionTime(190_000), lap: 19, kind: 'neutralised', severity: 'minor', carIds: [],
  timeLostMs: unknown('notApplicable'), forUs: [],
};
const damage: IncidentEntry = {
  id: 'damage:1:140000', at: toSessionTime(140_000), lap: 14, kind: 'damage', severity: 'major', carIds: [carId(1)],
  timeLostMs: unknown('insufficientData'), forUs: [],
};

const moment = (name: Moment): Known<RaceMoment> =>
  k({ moment: name, since: name === 'incident' ? known(toSessionTime(230_000), 10) : unknown('notApplicable'), cause: { rule: name, params: {} }, active: [name] });

/** Synthetic cases and fit expectations for `incident-feed`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceSingaporeStart.grid', 'raceSingaporeEnd.chequered'],
  cases: {
    empty: { feed: [], cars, moment: undefined },
    // Mockup: minor entries (warning, safety car) dim.
    feed: { feed: [collision, timeLoss, warning, neutralised, damage], cars, moment: undefined },
    // The unresolved time loss of the damage entry is an empty cell.
    unresolved: { feed: [damage], cars, moment: undefined },
    // Mockup: in the incident moment the newest major entry is amber.
    incidentMoment: { feed: [collision, timeLoss, warning, neutralised, damage], cars, moment: moment('incident') },
    // The newest entry is minor: the amber goes to the first major entry below it.
    incidentMomentMinorFirst: { feed: [warning, timeLoss, neutralised], cars, moment: moment('incident') },
    // Another moment: nothing amber.
    battleMoment: { feed: [collision, warning], cars, moment: moment('battle') },
    // A car missing from cars.overview shows as #<id>.
    unknownCar: { feed: [collision], cars: cars.slice(0, 2), moment: undefined },
    // Realism hides no rival value of this display (incidents are public), so there is no realism case.
  },
  fit: [
    { mode: 'compact', cols: 34, rows: 3 },
    { mode: 'compact', cols: 69, rows: 4 },
    { mode: 'full', cols: 70, rows: 5 },
    { mode: 'full', cols: 90, rows: 10 },
  ],
};

export default gallery;
