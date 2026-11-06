// Declaration of the lap-overview-grid display (spec 4, V09; mockups docs/design/2026-10-30-sp4a-displays/4-longrun.html
// and docs/design/2026-11-06-sp4.1b/changes.html): every lap of the link group's primary car as one block.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'lap-overview-grid',
  title: 'Lap overview',
  data: {
    // The car's laps in lap order, with heat, best and status.
    overview: topic('lapOverview.car', ({ link }) => ({ carId: link.primary })),
  },
  sizes: { compact: { minCols: 30, minRows: 3 }, full: { minCols: 84, minRows: 7 } },
});
