// Declaration of the alarm-list display (V25, spec 8.2): the active insights by severity, with acknowledge and mute by category.
import { declareWidget, folded, topic } from '../../kit/define-widget.ts';
import { activeInsights } from './rows.ts';

export const widget = declareWidget({
  name: 'alarm-list',
  title: 'Alarms',
  data: { insights: folded('insights', activeInsights), alerts: topic('ui.alerts') },
  sizes: { compact: { minCols: 40, minRows: 3 }, full: { minCols: 62, minRows: 6 } },
});
