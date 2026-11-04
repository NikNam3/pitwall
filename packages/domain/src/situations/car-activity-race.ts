// The race's car-activity sub-machine's span declaration (contract C15, C17): car-scoped, what a car is doing by the
// race's rules, from lights out. `notCompeting` while its car status is retired, disqualified or absent (no gaps).
import { defineSpans, type SpanRef } from '../facts.ts';

/** The detail of a `servingPenalty` span: the penalty being served and the `penalties` span (open or closed) it serves. */
export type ServingPenaltyDetail = { penalty: 'driveThrough' | 'stopGo'; given: SpanRef };

/** A car's race activity (`spans:car-activity-race`); only `servingPenalty` has a detail. */
export const spans = defineSpans({
  machine: 'car-activity-race',
  scope: 'car',
  kinds: ['racingLap', 'inLap', 'boxStop', 'servingPenalty', 'outLap', 'finished', 'coolDown', 'notCompeting'],
});
