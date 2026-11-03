// The practice car-activity sub-machine's span declaration (contract C15, C17): car-scoped, what a car is doing by
// practice's rules. `notCompeting` while its car status is retired, disqualified or absent (no gaps).
import { defineSpans } from '../facts.ts';

/** A car's practice activity (`spans:car-activity-practice`); no detail. */
export const spans = defineSpans({
  machine: 'car-activity-practice',
  scope: 'car',
  kinds: ['outLap', 'flyingLap', 'inLap', 'garage', 'finished', 'notCompeting'],
});
