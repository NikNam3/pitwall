// Declaration of the crossing-order display (SP4.2 spec §4; mockup docs/design/2026-10-30-sp4a-displays/1-ghost-views.html):
// per condition the crossing order around the rejoin ghost of the link group's primary car.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'crossing-order',
  title: 'Crossing order',
  data: {
    // The ghost per condition: its loss with the source, the order around it.
    rejoin: topic('rejoin.car', ({ link }) => ({ carId: link.primary })),
    // The condition that is out (a `neutralised` span's car, C20).
    phase: topic('situation.sessionPhaseRace'),
    // Driver codes of the order's cars.
    cars: topic('cars.overview'),
    // Our cars (player and teammate) take the own-car colour.
    session: topic('session.info'),
  },
  // Mockup 1-ghost-views.html: full 54×9 (three conditions side by side), compact 20×7 (one condition).
  sizes: { compact: { minCols: 20, minRows: 7 }, full: { minCols: 54, minRows: 9 } },
});
