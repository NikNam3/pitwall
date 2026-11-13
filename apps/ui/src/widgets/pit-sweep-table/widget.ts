// Declaration of the pit-sweep-table display (SP4.3b spec §10, V15; mockup docs/design/2026-11-12-sp4.3b/pit-sweep-table.html):
// per stop lap from now, "box at L onto the swept compound, then the DP's best continuation" (`pitSweep.car`).
// Written by the test phase from the plan's Task 14 interface (data, option, sizes), so the fixtures typecheck.
import { declareWidget, topic } from '../../kit/define-widget.ts';
import { choiceOption } from '../../kit/options.ts';
import * as text from './text.ts';

/** The compound option's choices: `auto` (the one `pit-window` names), then the five compounds a call can sweep. */
export const COMPOUND_CHOICES = ['auto', 'soft', 'medium', 'hard', 'inter', 'wet'] as const;

export const widget = declareWidget({
  name: 'pit-sweep-table',
  title: 'Pit sweep',
  data: {
    // The link group's primary car's sweep of the panel's compound (our cars only; a job's result).
    sweep: topic('pitSweep.car', ({ link, options }) => ({
      carId: link.primary,
      compound: options['compound'] as (typeof COMPOUND_CHOICES)[number],
    })),
  },
  // A panel option: a persistent change through the panel (C73, C74); the popover is the shell's.
  options: { compound: choiceOption(COMPOUND_CHOICES, 'auto', text.compound) },
  // Mockup pit-sweep-table.html: full 53×14 (the header, 13 stop laps), compact 26×6 (the header, 5 stop laps).
  sizes: { compact: { minCols: 26, minRows: 6 }, full: { minCols: 53, minRows: 14 } },
});
