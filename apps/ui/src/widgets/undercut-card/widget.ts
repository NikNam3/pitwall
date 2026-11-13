// Declaration of the undercut-card display (SP4.3b spec §9.1, §10, V13; mockup docs/design/2026-11-12-sp4.3b/undercut-card.html):
// per rival in range and N = 1–3, ΔGAP once both have stopped, P(ahead), the gain strip and our rejoin place; our own
// line between the rivals ahead and behind.
// Written by the test phase from the plan's Task 13 interface (data, sizes), so the fixtures typecheck.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'undercut-card',
  title: 'Undercut',
  data: {
    // The link group's primary car's undercut call (our cars only; a job's result).
    undercut: topic('undercut.car', ({ link }) => ({ carId: link.primary })),
    // The field's identities: a rival's (and our) code from its name, never its slot.
    cars: topic('cars.overview'),
  },
  // Mockup undercut-card.html: full 47×11, compact 26×5.
  sizes: { compact: { minCols: 26, minRows: 5 }, full: { minCols: 47, minRows: 11 } },
});
