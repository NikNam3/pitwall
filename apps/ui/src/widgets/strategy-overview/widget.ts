// Declaration of the strategy-overview display, title "Field plans" (SP4.3d spec §6.4, V06; mockup
// docs/design/2026-11-16-sp4.3d/strategy-overview.html): per car within one pit loss of the link's car (and its teammate)
// a lap lane: past stints solid, a rival's predicted window shaded, our plan A outlined and plan B's stops marked.
// Written by the test phase from the plan's Task 13 interface (data, sizes), so the fixtures typecheck.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'strategy-overview',
  title: 'Field plans',
  data: {
    // The link group's primary car's overview (our cars only).
    overview: topic('strategyOverview.car', ({ link }) => ({ carId: link.primary })),
    // The field's identities (a row's code from its name, never its slot) and the lap now (our car's `timing.lap`).
    cars: topic('cars.overview'),
    // The race's laps: the lane's end (`session.totalLaps`).
    session: topic('session.info'),
  },
  // Mockup strategy-overview.html: full 71×10 (the header and nine rows), compact 28×10.
  sizes: { compact: { minCols: 28, minRows: 10 }, full: { minCols: 71, minRows: 10 } },
});
