// Declaration of the sc-card display (SP4.3b spec §10, V18; mockup docs/design/2026-11-12-sp4.3b/sc-card.html): per
// condition (SC, VSC) the Monte Carlo's places gained by a stop now, its chance of a gain and its distribution, our rejoin
// position, the stop's loss and the trigger range; the condition that is out, from the race's session phase.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'sc-card',
  title: 'SC / VSC call',
  data: {
    // The SC and VSC rows of the panel's primary car (one of our cars; a rival has no value).
    call: topic('scCall.car', ({ link }) => ({ carId: link.primary })),
    // The race's session phase: a `neutralised` span names the condition that is out (its `detail.car`).
    phase: optional(topic('situation.sessionPhaseRace')),
  },
  sizes: { compact: { minCols: 26, minRows: 2 }, full: { minCols: 45, minRows: 3 } },
});
