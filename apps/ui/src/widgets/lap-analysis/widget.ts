// Declaration of the lap-analysis display (spec 8.3, V28): every car's best lap and sectors as deltas to the reference car.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'lap-analysis',
  title: 'Lap analysis',
  data: {
    // Deltas are measured to the link group's primary car, which shows absolute times instead.
    board: topic('lapTimes.board', ({ link }) => ({ referenceCarId: link.primary })),
    // Driver codes.
    cars: topic('cars.overview'),
    // Our cars (player and teammate): personal bests light up for them only.
    session: topic('session.info'),
  },
  sizes: { compact: { minCols: 22, minRows: 4 }, full: { minCols: 44, minRows: 6 } },
});
