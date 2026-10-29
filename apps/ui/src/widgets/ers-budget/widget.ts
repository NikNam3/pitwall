// Declaration of the ers-budget display (spec 8.2, V23): store against the attack level, this lap's deploy and harvest, the trend.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'ers-budget',
  title: 'ERS',
  data: {
    ers: topic('ers.car', ({ link }) => ({ carId: link.primary })),
    moment: optional(topic('raceMoment.current')),
  },
  // Mockup 1-car-care.html: 50x4 (STORE, DEPLOY, HARVEST, TREND). One mode only: the rows do not shrink.
  sizes: { full: { minCols: 50, minRows: 4 } },
});
