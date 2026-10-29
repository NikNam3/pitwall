// Declaration of the projected-lap display (spec 8.3, V10 + V11): the projected lap, the quali cut-off and the finish margin.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'projected-lap',
  title: 'Projected lap',
  data: {
    // The link group's primary car.
    projection: topic('lapTimes.projection', ({ link }) => ({ carId: link.primary })),
    // Our cars: a projection faster than the best is green only for them (a rival can be the primary).
    session: optional(topic('session.info')),
  },
  // Mockup 2-timing.html: full 42x4 (column header, PROJ, CUT-OFF, FINISH), compact = column header and PROJ without the label column.
  sizes: { compact: { minCols: 29, minRows: 2 }, full: { minCols: 42, minRows: 4 } },
});
