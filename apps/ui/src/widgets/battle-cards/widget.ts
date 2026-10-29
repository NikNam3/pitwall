// Declaration of the battle-cards display (spec 8.3, V14): one row per neighbour of the link group's primary car.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'battle-cards',
  title: 'Battle',
  data: {
    card: topic('battle.cards', ({ link }) => ({ carId: link.primary })),
    cars: topic('cars.overview'),
    moment: optional(topic('raceMoment.current')),
  },
  // Mockup 2-timing.html: full 70x3 (header, AHEAD, BEHIND), compact 26x3 (DRV GAP TO DRS).
  sizes: { compact: { minCols: 26, minRows: 3 }, full: { minCols: 70, minRows: 3 } },
});
