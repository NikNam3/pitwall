// A car's status as car-status decided it (contract C17, C20, C43): the one place units read whether a car is in the
// session, instead of `car.active` or the game's result status. They decide nothing again.
import { carStatusSpans, type CarId } from '@pitwall/domain';
import type { ChangeTag, EngineView } from '@pitwall/engine/readers';
import { openSpansByCar } from './behaviour.ts';

/** A car's status: competing, retired, disqualified or absent. */
export type CarStatusKind = (typeof carStatusSpans.kinds)[number];

/** What a reader of these helpers declares (C41): car-status's spans. */
export const CAR_STATUS_READS = 'spans:car-status' satisfies ChangeTag;

/**
 * The one in-session row set (C43, C44, SP4.3c O7): every car-status kind but `absent` is in the session and has an
 * entry. A unit that reads car-status spreads these rows into its behaviour table's `car-status` part.
 */
export const IN_SESSION_ROWS = {
  competing: { inSession: true },
  retired: { inSession: true },
  disqualified: { inSession: true },
  absent: { inSession: false },
} as const satisfies Readonly<Record<CarStatusKind, { inSession: boolean }>>;

/** The cars in the session (any status but `absent`), by id ascending: car-status's open spans read once (`spans:car-status`, C41). */
export function carsInSession(view: EngineView): CarId[] {
  const ids: CarId[] = [];
  for (const [id, spans] of openSpansByCar(view, carStatusSpans.machine)) {
    const kind = spans[0]?.kind;
    if (kind !== undefined && kind !== 'absent') ids.push(id);
  }
  return ids.sort((a, b) => a - b);
}
