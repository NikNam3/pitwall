// The practice session-phase sub-machine (contract C9, C14, C15, C17): session-scoped, for the practice phase, after
// the weekend phase. Its kinds and transitions are the qualifying machine's (`session-phase/timed.ts`).
import { sessionPhasePracticeSpans } from '@pitwall/domain';
import { timedSessionMachine } from '../session-phase/timed.ts';

export default timedSessionMachine(sessionPhasePracticeSpans, 'practice');
