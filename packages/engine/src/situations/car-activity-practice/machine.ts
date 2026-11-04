// The practice car-activity sub-machine (contract C9, C14, C15, C17): per car, what it is doing by practice's rules
// (out lap, flying lap, in lap, garage, finished, not competing), for the practice phase, after car-location,
// car-status and the practice session phase. Its rules and transitions are the qualifying machine's
// (`car-activity-timed/timed.ts`), its push kind `flyingLap`.
import { carActivityPracticeSpans } from '@pitwall/domain';
import { timedActivityMachine } from '../car-activity-timed/timed.ts';

export default timedActivityMachine(carActivityPracticeSpans, 'practice', 'session-phase-practice', 'flyingLap');
