// The cars car-status has had in the session (M7-R): every car with a span whose behaviour row lists it, open now or
// closed in the projection (C20, C26); the one reader of car-status's closed spans in this unit.
import { carStatusSpans, type CarId } from '@pitwall/domain';
import { openSpansOf, type EngineView } from '@pitwall/engine/readers';
import { PIT_STOP_COUNT_BEHAVIOUR } from './behaviour.ts';

const ROWS = PIT_STOP_COUNT_BEHAVIOUR[carStatusSpans.machine] ?? {};

/**
 * The cars with a listed car-status span (`PIT_STOP_COUNT_BEHAVIOUR`), open or closed, by id ascending. Reads
 * `spans:car-status` (C41). A kind without a row is a bug in the table (C3): it throws.
 */
export function carsOfSession(view: EngineView): CarId[] {
  const ids = new Set<CarId>();
  const spans = [...openSpansOf(view, carStatusSpans.machine), ...(view.history.spans[carStatusSpans.machine] ?? [])];
  for (const span of spans) {
    if (span.carId === undefined || ids.has(span.carId)) continue;
    if (!Object.hasOwn(ROWS, span.kind)) throw new Error(`behaviour table: no row for ${carStatusSpans.machine} ${span.kind}`);
    if (ROWS[span.kind]?.listed === true) ids.add(span.carId);
  }
  return [...ids].sort((a, b) => a - b);
}
