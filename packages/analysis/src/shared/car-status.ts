// A car's status as car-status decided it (contract C17, C20, C43): the one place units read whether a car is in the
// session or still competes, instead of `car.active` or the game's result status. They decide nothing again.
import { carStatusSpans, known, unknown, type CarId, type Known } from '@pitwall/domain';
import { openSpansOf, type ChangeTag, type EngineView } from '@pitwall/engine/readers';
import { openSpansByCar } from './behaviour.ts';

/** A car's status: competing, retired, disqualified or absent. */
export type CarStatusKind = (typeof carStatusSpans.kinds)[number];

/** What a reader of these helpers declares (C41): car-status's spans. */
export const CAR_STATUS_READS = 'spans:car-status' satisfies ChangeTag;

/**
 * The kind of the car's open car-status span, known since the span started; `unknown('notReceived')` while car-status
 * has no span open for the car. Reads `openSpansOf` (`spans:car-status`, C41).
 */
export function carStatusKind(view: EngineView, carId: CarId): Known<CarStatusKind> {
  const span = openSpansOf(view, carStatusSpans.machine, carId)[0];
  return span === undefined ? unknown('notReceived') : known(span.kind as CarStatusKind, span.start);
}

/** The car is in the session: its status is known and not `absent` (as the engine's `carsInSessionOf` reads it). */
export function inSession(view: EngineView, carId: CarId): boolean {
  const kind = carStatusKind(view, carId);
  return kind.known && kind.value !== 'absent';
}

/** The car still competes: its status is `competing`. */
export function competing(view: EngineView, carId: CarId): boolean {
  const kind = carStatusKind(view, carId);
  return kind.known && kind.value === 'competing';
}

/** The cars in the session (`inSession`), by id ascending: car-status's open spans read once (`spans:car-status`, C41). */
export function carsInSession(view: EngineView): CarId[] {
  const ids: CarId[] = [];
  for (const [id, spans] of openSpansByCar(view, carStatusSpans.machine)) {
    const kind = spans[0]?.kind;
    if (kind !== undefined && kind !== 'absent') ids.push(id);
  }
  return ids.sort((a, b) => a - b);
}
