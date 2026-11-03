// The machine's output as readers see it (contract C20). Protocol-free, so recorders and the view can import it (C6).
import type { MachineId, OpenSpan, WeekendPhase } from '@pitwall/domain';
import type { DeepReadonly } from '../util/deep-readonly.ts';

/** The machine's open spans (C20); the clock's open span (`running` or `paused`) is `byMachine.clock`. */
export type Situation = DeepReadonly<{ weekendPhase: WeekendPhase; byMachine: Record<MachineId, OpenSpan[]> }>;

/** No open span, the weekend phase still pending: a new session's situation, before its first frame. */
export const emptySituation = (): Situation => ({ weekendPhase: { kind: 'pending' }, byMachine: {} });
