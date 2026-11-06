// Declaration of the crossover-chart display (SP4.1b spec 4; mockup docs/design/2026-10-30-sp4a-displays/5-weather.html):
// the field's median lap per tyre type against our car's, with the three numbers US, FIRST FASTER and PAYBACK.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'crossover-chart',
  title: 'Crossover',
  data: {
    // The medians per type and the three numbers, for the link group's primary car.
    crossover: topic('crossover.car', ({ link }) => ({ carId: link.primary })),
    // The first faster car's code.
    cars: topic('cars.overview'),
  },
  sizes: { compact: { minCols: 40, minRows: 3 }, full: { minCols: 72, minRows: 16 } },
});
