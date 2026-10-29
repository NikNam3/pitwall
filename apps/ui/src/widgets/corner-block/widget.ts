// Declaration of the corner-block display (spec 8.2, V22): per corner temperatures, pressure, brake and wear, plus the engine.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'corner-block',
  title: 'Corners',
  data: {
    bands: topic('carBands.car', ({ link }) => ({ carId: link.primary })),
    wear: topic('tyreWear.car', ({ link }) => ({ carId: link.primary })),
    car: topic('car.detail', ({ link }) => ({ carId: link.primary })),
  },
  // Mockup 1-car-care.html: full 44x7 (header, four corners, blank, ENG), compact 26x3.
  sizes: { compact: { minCols: 26, minRows: 3 }, full: { minCols: 44, minRows: 7 } },
});
