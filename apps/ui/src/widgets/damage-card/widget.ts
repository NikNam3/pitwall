// Declaration of the damage-card display (spec 8.2, V31): damage per part, per corner, faults and the jumps.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'damage-card',
  title: 'Damage',
  data: {
    damage: topic('damage.car', ({ link }) => ({ carId: link.primary })),
  },
  // Mockup 1-car-care.html: full 44x9 (wing row, floor/diff/sidepod row, gearbox/engine row, corner header, two corner rows, two jumps);
  // compact 26x2 (the parts line and the newest jump).
  sizes: { compact: { minCols: 26, minRows: 2 }, full: { minCols: 44, minRows: 9 } },
});
