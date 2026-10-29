// Test-only widget: two value cells of the linked car, a telemetry one and a damage one, so their staleness reaches the panel.
import { declareWidget, topic } from '../../../../src/kit/define-widget.ts';

export const widget = declareWidget({
  name: 'car-cell-probe',
  title: 'Car cell probe',
  data: { status: topic('feed.status'), car: topic('car.detail', ({ link }) => ({ carId: link.primary })) },
  sizes: { compact: { minCols: 10, minRows: 2 } },
});
