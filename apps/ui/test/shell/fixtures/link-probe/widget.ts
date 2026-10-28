// Test-only widget that records the `link` objects it receives.
import { declareWidget, topic } from '../../../../src/kit/define-widget.ts';

export const widget = declareWidget({
  name: 'link-probe',
  title: 'Link probe',
  data: { status: topic('feed.status') },
  sizes: { compact: { minCols: 10, minRows: 2 } },
});
