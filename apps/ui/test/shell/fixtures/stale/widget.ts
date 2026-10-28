// Test-only widget whose component reports 4000 ms of staleness to its panel.
import { declareWidget, topic } from '../../../../src/kit/define-widget.ts';

export const widget = declareWidget({
  name: 'stale-probe',
  title: 'Stale probe',
  data: { status: topic('feed.status') },
  sizes: { compact: { minCols: 10, minRows: 2 } },
});
