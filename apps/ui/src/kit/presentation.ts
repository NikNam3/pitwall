// The presentation table of a display (contract C66): a pure map from the kinds of each sub-machine it reads (a
// `situation.<machine>` topic) and from every `Moment` (when it reads `raceMoment.current`) to its presentation:
// layout variant, visible parts, emphasis. A display's `presentation.ts` exports it as `presentation`; its row type is
// the display's own. `test/presentation-completeness.test.ts` checks that it covers every kind it reads, and no more.
import type { MachineId, Moment } from '@pitwall/domain';

export type PresentationTable = {
  /** Per sub-machine the display reads: one row per span kind of its declaration (`SPAN_DECLARATIONS`). */
  readonly situations?: Readonly<Record<MachineId, Readonly<Record<string, unknown>>>>;
  /** One row per `Moment`, for a display that reads `raceMoment.current`. */
  readonly moments?: Readonly<Record<Moment, unknown>>;
};
