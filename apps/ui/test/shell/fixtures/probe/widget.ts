// Test-only widget: one required and one optional topic, three options. Not a real widget.
import { boolOption, choiceOption, numberOption } from '../../../../src/kit/options.ts';
import { declareWidget, optional, topic } from '../../../../src/kit/define-widget.ts';

export const widget = declareWidget({
  name: 'probe',
  title: 'Probe',
  data: {
    status: topic('feed.status'),
    detail: optional(topic('car.detail', ({ link }) => ({ carId: link.primary }))),
  },
  options: {
    mode: choiceOption(['a', 'b'] as const, 'a', 'Mode'),
    count: numberOption(3, 'Count', { min: 1, max: 9, step: 1 }),
    flag: boolOption(false, 'Flag'),
  },
  sizes: { compact: { minCols: 10, minRows: 2 } },
});
