import { registerWidget } from '../../../../src/kit/define-widget.ts';
import { widget } from './widget.ts';

export default registerWidget(widget, () => import('./LinkProbe.svelte'));
