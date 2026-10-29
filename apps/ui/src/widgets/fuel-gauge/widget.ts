// Declaration of the fuel-gauge display (V20, spec 8.2): fuel margin in laps, burn, save target, the game's estimate.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'fuel-gauge',
  title: 'Fuel',
  data: { fuel: topic('fuel.car', ({ link }) => ({ carId: link.primary })) },
  sizes: { compact: { minCols: 30, minRows: 2 }, full: { minCols: 30, minRows: 6 } },
});
