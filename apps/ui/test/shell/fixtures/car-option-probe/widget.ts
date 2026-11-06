// Test-only widget: two car options, one of the `none` variant (a rival picker) and one of the default `follow` variant.
import { carOption } from '../../../../src/kit/options.ts';
import { declareWidget, topic } from '../../../../src/kit/define-widget.ts';

export const widget = declareWidget({
  name: 'car-option-probe',
  title: 'Car option probe',
  data: { status: topic('feed.status') },
  options: {
    rival: carOption('Rival 1', { unset: 'none' }),
    car: carOption('Car'),
  },
  sizes: { compact: { minCols: 10, minRows: 2 } },
});
