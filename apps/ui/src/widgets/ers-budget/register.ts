import { registerWidget } from '../../kit/define-widget.ts';
import { widget } from './widget.ts';

export default registerWidget(widget, () => import('./ErsBudget.svelte'));
