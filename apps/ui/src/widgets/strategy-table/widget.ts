// Declaration of the strategy-table display (SP4.3b spec §10, V16; mockup docs/design/2026-11-12-sp4.3b/strategy-table-b.html,
// variant B, Q9 B): every policy's finishing-place distribution as one line on one chart, the list of policies beside it,
// the highlighted policy's info rows below; commit and clear a plan (C74, full size only, Q7 A).
// Written by the test phase from the plan's Task 12 interface (data, actions, sizes), so the fixtures typecheck. SP4.3d1
// Task 3: `cars` (the rivals' race numbers for the trigger lines) is deleted with the triggers. SP4.3d2 Task 12: the
// planning round's source (`plans.preview`, by the link's car; `plans.prepared` for the round's state), option `source`.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';
import { choiceOption } from '../../kit/options.ts';

/** Where the table's rows come from: `auto` (the planning round while it is open, else the race), the race's strategy job, or the planning round's job. */
export const SOURCES = ['auto', 'live', 'planning'] as const;

export const widget = declareWidget({
  name: 'strategy-table',
  title: 'Strategy',
  data: {
    // The link group's primary car's ranked policies (our cars only; a job's result).
    plan: optional(topic('strategy.car', ({ link }) => ({ carId: link.primary }))),
    // The planning job's ranking for the same car (SP4.3d spec §7.4; plan-workbook.html: the table in the planning round).
    preview: optional(topic('plans.preview', ({ link }) => ({ carId: link.primary }))),
    // The planning round's state: whether it is open (the `auto` source).
    prepared: optional(topic('plans.prepared')),
  },
  options: { source: choiceOption(SOURCES, 'auto', 'Source') },
  // Mockup strategy-table-b.html: full 88×13 (chart 9 rows, the info header, two info rows, the footer), compact 46×6.
  sizes: { compact: { minCols: 46, minRows: 6 }, full: { minCols: 88, minRows: 13 } },
  // SP4.3d1 Task 11: commit became "save to slot …" (plan.save); a saved row is activated (plan.activate).
  actions: ['plan.save', 'plan.activate', 'plan.clear'],
});
