// Declaration of the alarm-list display (V25, spec 8.2): the active insights by severity, with acknowledge and mute by category.
import { declareWidget, folded, optional, topic } from '../../kit/define-widget.ts';
import { activeInsights } from '../../kit/folds.ts';

export const widget = declareWidget({
  name: 'alarm-list',
  title: 'Alarms',
  // `cars` gives each row its car's code; the rows show their texts alone until it arrives
  data: { insights: folded('insights', activeInsights), alerts: topic('ui.alerts'), cars: optional(topic('cars.overview')) },
  sizes: { compact: { minCols: 40, minRows: 3 }, full: { minCols: 62, minRows: 6 } },
  actions: ['alert.ack', 'alertGroup.mute'],
});
