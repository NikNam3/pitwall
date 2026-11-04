// Situations as displays read them (contract C20, C54, C65): a `situation.<machine>` topic carries one sub-machine's
// open spans, as they are. Picking the open span of the session or of one car is selection, nothing else:
// the machine decided the situation; a display maps its kind through its presentation table (C66).
import type { MachineSpans } from '@pitwall/contracts';
import type { CarId, OpenSpan } from '@pitwall/domain';

/**
 * The open span of a sub-machine's topic value for `carId` (a car sub-machine), or the session's open span when `carId`
 * is left out (a session sub-machine); `undefined` while the topic has no value or no such span is open.
 */
export function openSpanOf(spans: MachineSpans | undefined, carId?: CarId): OpenSpan | undefined {
  return spans?.open.find((span) => span.carId === carId);
}
