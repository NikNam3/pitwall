// The qualifying session-phase sub-machine (contract C9, C14, C15, C17): session-scoped, for the qualifying phase
// (the sprint shootout included), after the weekend phase. Its kinds and transitions are the practice machine's
// (`session-phase/timed.ts`).
import { sessionPhaseQualifyingSpans } from '@pitwall/domain';
import { timedSessionMachine } from '../session-phase/timed.ts';

export default timedSessionMachine(sessionPhaseQualifyingSpans, 'qualifying');
