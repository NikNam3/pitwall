// Declaration of the stint-scatter display (spec 6; approved mockup docs/design/2026-10-30-sp4a-displays/4-longrun.html,
// compounds table redrawn in docs/design/2026-11-06-sp4.1a/source-badge.html): the link group's primary car's stints, lap
// times over tyre age with the fit and its band, and the prior per compound with its source.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'stint-scatter',
  title: 'Stint scatter',
  data: {
    analysis: topic('stintAnalysis.car', ({ link }) => ({ carId: link.primary })),
  },
  // Mockup README: compact 36x8 (the chart of the current stint), full 72x16 (every stint, the basis, the compounds table).
  sizes: { compact: { minCols: 36, minRows: 8 }, full: { minCols: 72, minRows: 16 } },
});
