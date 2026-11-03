// The qualifying car-activity sub-machine's span declaration (contract C15, C17): car-scoped, what a car is doing by
// qualifying's rules. `notCompeting` while its car status is retired, disqualified or absent (no gaps).
import { defineSpans } from '../facts.ts';

/** A car's qualifying activity (`spans:car-activity-qualifying`); no detail. */
export const spans = defineSpans({
  machine: 'car-activity-qualifying',
  scope: 'car',
  kinds: ['outLap', 'pushLap', 'inLap', 'garage', 'finished', 'notCompeting'],
});
