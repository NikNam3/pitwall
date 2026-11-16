// Declaration of the sc-card display, the Box call (SP4.3d spec §6.3; mockup docs/design/2026-11-16-sp4.3d/sc-card.html):
// per condition (SC, VSC, GREEN while green; only the out condition's while one is out) the six answers stay, box S, M,
// H, I, W with E[pos], ΔPOS against stay, P(gain), the rejoin position and the position distribution; the condition that
// is out, from the race's session phase.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';
import * as text from './text.ts';

export const widget = declareWidget({
  name: 'sc-card',
  title: text.title,
  data: {
    // The blocks of the panel's primary car (one of our cars; a car the call does not apply to has none).
    call: topic('scCall.car', ({ link }) => ({ carId: link.primary })),
    // The race's session phase: a `neutralised` span names the condition that is out (its `detail.car`).
    phase: optional(topic('situation.sessionPhaseRace')),
  },
  sizes: { compact: { minCols: 26, minRows: 3 }, full: { minCols: 58, minRows: 23 } },
});
