// The cars in the session as car-status decided them (contract C20, C43): a car is in the session while its car-status
// span is not `absent`. For the readers of car-status's open spans (the recorders' situation, the session-phase machines'
// upstream, the flag phases); no reader decides it again. Protocol-free and signal-free (C6, C13).
import type { CarId, OpenSpan } from '@pitwall/domain';
import type { DeepReadonly } from '../../util/deep-readonly.ts';

/** The sub-machine that decides which cars are in the session. */
export const CAR_STATUS = 'car-status';

/** The cars whose car-status span is not `absent`, by id, in slot order; none before car-status opened a span. */
export const carsInSessionOf = (spans: ReadonlyArray<DeepReadonly<OpenSpan>> | undefined): CarId[] =>
  (spans ?? []).flatMap((span) => (span.kind !== 'absent' && span.carId !== undefined ? [span.carId] : [])).sort((a, b) => a - b);
