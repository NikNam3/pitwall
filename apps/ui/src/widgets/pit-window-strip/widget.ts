// Declaration of the pit-window-strip display (SP4.2 spec §4; mockup docs/design/2026-11-07-sp4.2/pit-window.html): the
// race's lap axis with the fitted set and, per new set, its pit window.
import { declareWidget, topic } from '../../kit/define-widget.ts';
import { boolOption } from '../../kit/options.ts';
import * as text from './text.ts';

export const widget = declareWidget({
  name: 'pit-window-strip',
  title: 'Pit window',
  data: {
    // The link group's primary car's window (our cars only).
    window: topic('pitWindow.car', ({ link }) => ({ carId: link.primary })),
  },
  // K16: the other type's sets only on request, below the same-type ones.
  options: { otherType: boolOption(false, text.otherType) },
  // Mockup pit-window.html: full 46x4 (the fitted set, two sets, the axis), compact 22x3 (text only).
  sizes: { compact: { minCols: 22, minRows: 3 }, full: { minCols: 46, minRows: 4 } },
});
