// Declaration of the plan-board display (SP4.3d spec §6.2, V17; mockup docs/design/2026-11-16-sp4.3d/plan-board.html):
// per our car the plan slots (the active one marked, ΔPOS and ΔTIME against it, E[POS] with the MC's SE, the places
// strip, an infeasible slot faint), then the DP's best plan per stop count with `→ slot` or `= <slot>`; save to a slot,
// activate, edit (a window-local draft, C73), remove (C72, C74).
// Written by the test phase from the plan's Task 11 interface (data, options, sizes, actions), so the fixtures typecheck.
import { declareWidget, optional, topic } from '../../kit/define-widget.ts';
import { choiceOption } from '../../kit/options.ts';

/** Where the board's rows come from: the race's strategy job, or the planning round's (4.3d2; notApplicable until then). */
export const SOURCES = ['live', 'planning'] as const;

export const widget = declareWidget({
  name: 'plan-board',
  title: 'Plan board',
  data: {
    // The link group's primary car's ranked rows (our cars only; the strategy job's result, C51).
    plan: topic('strategy.car', ({ link }) => ({ carId: link.primary })),
    // The race's session phase: its presentation table decides whether the board offers its actions (C66).
    phase: optional(topic('situation.sessionPhaseRace')),
  },
  options: { source: choiceOption(SOURCES, 'live', 'Source') },
  // Mockup plan-board.html: full 82×13 (header, five slots, the DP line, four DP rows, a blank, the actions line),
  // compact 37×7 (header, three slots, the DP line, the DP's 1- and 2-stop).
  sizes: { compact: { minCols: 37, minRows: 7 }, full: { minCols: 82, minRows: 13 } },
  actions: ['plan.save', 'plan.activate', 'plan.remove'],
});
