// Declaration of the timing-tower display (spec 8.3, V29): the field in position order, with gaps, last lap, sectors and tyres.
import type { Fold } from '@pitwall/contracts';
import type { PitStopRecord, StintRecord } from '@pitwall/domain';
import { declareWidget, folded, optional, topic } from '../../kit/define-widget.ts';
import { boolOption } from '../../kit/options.ts';

/** Collects every entry of an append topic into a list (stints and pit stops are read per car by `buildRows`). */
function collect<E>(): Fold<E, E[]> {
  return { init: () => [], add: (acc, entries) => [...acc, ...entries] };
}

export const widget = declareWidget({
  name: 'timing-tower',
  title: 'Timing',
  data: {
    cars: topic('cars.overview'),
    intervals: topic('gaps.intervals'),
    // TO US: every car's gap to the link group's primary car (our car).
    toCar: topic('gaps.toCar', ({ link }) => ({ carId: link.primary })),
    // Deltas are measured to the same car.
    board: topic('lapTimes.board', ({ link }) => ({ referenceCarId: link.primary })),
    stints: folded('stints', collect<StintRecord>()),
    pitStops: folded('pitStops', collect<PitStopRecord>()),
    moment: optional(topic('raceMoment.current')),
    neighbourhood: topic('gaps.neighbourhood'),
  },
  options: { showRetired: boolOption(true, 'Show retired cars') },
  sizes: { compact: { minCols: 30, minRows: 6 }, full: { minCols: 84, minRows: 9 } },
});
