// Test-only widget on a topic whose values the tests send as `Computed` (value plus `computedFor`).
import { declareWidget, topic } from '../../../../src/kit/define-widget.ts';

export const widget = declareWidget({
  name: 'computed-probe',
  title: 'Computed probe',
  data: { detail: topic('car.detail', ({ link }) => ({ carId: link.primary })) },
  sizes: { compact: { minCols: 10, minRows: 2 } },
});
