// Declaration of the timing-tower display (spec 8.3, V29): the field in position order, with gaps, last lap, sectors and tyres.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';
import { boolOption } from '../../kit/options.ts';

export const widget = declareWidget({
  name: 'timing-tower',
  title: 'Timing',
  data: {
    // Stops and compound arrive reconciled with the stint and pit-stop records.
    cars: topic('cars.overview'),
    intervals: topic('gaps.intervals'),
    // TO US: every car's gap to the link group's primary car; that car's own entry is notApplicable (an empty cell).
    toCar: topic('gaps.toCar', ({ link }) => ({ carId: link.primary })),
    // Deltas are measured to the same car.
    board: topic('lapTimes.board', ({ link }) => ({ referenceCarId: link.primary })),
    moment: optional(topic('raceMoment.current')),
    // Our cars (player and teammate) and the incidents of the incident moment.
    session: topic('session.info'),
    incidents: optional(topic('incidents.feed')),
  },
  options: { showRetired: boolOption(true, 'Show retired cars') },
  sizes: { compact: { minCols: 30, minRows: 6 }, full: { minCols: 84, minRows: 9 } },
});
