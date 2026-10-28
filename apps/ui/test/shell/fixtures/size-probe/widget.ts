// Test-only widget that shows the cell grid the shell measured for it.
import { declareWidget, topic } from '../../../../src/kit/define-widget.ts';

export const widget = declareWidget({
  name: 'size-probe',
  title: 'Size probe',
  data: { status: topic('feed.status') },
  sizes: { compact: { minCols: 10, minRows: 2 } },
});
