// Declaration of the tyre-life-bar display (V21, spec 8.2): per corner the wear bar, its rate and the laps to the limit.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'tyre-life-bar',
  title: 'Tyre life',
  data: {
    wear: topic('tyreWear.car', ({ link }) => ({ carId: link.primary })),
    car: optional(topic('car.detail', ({ link }) => ({ carId: link.primary }))), // header only: the bars render without it
  },
  // Mockup 1-car-care.html: 47 x 5 (column header plus four corners). Compact shrinks only the bar (see `barColumns`).
  sizes: { compact: { minCols: 36, minRows: 5 }, full: { minCols: 47, minRows: 5 } },
});
