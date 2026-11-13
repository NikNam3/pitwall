import { registerWidget } from '../../kit/define-widget.ts';
import { widget } from './widget.ts';

export default registerWidget(widget, () => import('./DriversPanel.svelte'));
