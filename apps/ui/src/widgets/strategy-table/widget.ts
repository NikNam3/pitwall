// Declaration of the strategy-table display (SP4.3b spec §10, V16; mockup docs/design/2026-11-12-sp4.3b/strategy-table-b.html,
// variant B, Q9 B): every policy's finishing-place distribution as one line on one chart, the list of policies beside it,
// the highlighted policy's info rows below; commit and clear a plan (C74, full size only, Q7 A).
// Written by the test phase from the plan's Task 12 interface (data, actions, sizes), so the fixtures typecheck.
import { declareWidget, topic } from '../../kit/define-widget.ts';

export const widget = declareWidget({
  name: 'strategy-table',
  title: 'Strategy',
  data: {
    // The link group's primary car's ranked policies (our cars only; a job's result).
    plan: topic('strategy.car', ({ link }) => ({ carId: link.primary })),
  },
  // Mockup strategy-table-b.html: full 88×13 (chart 9 rows, the info header, two info rows, the footer), compact 46×6.
  sizes: { compact: { minCols: 46, minRows: 6 }, full: { minCols: 88, minRows: 13 } },
  actions: ['plan.commit', 'plan.clear'],
});
