// The qualifying car-activity sub-machine (contract C9, C14, C15, C17): per car, what it is doing by qualifying's rules
// (out lap, push lap, in lap, garage, finished, not competing), for the qualifying phase (the sprint shootout included),
// after car-location, car-status and the qualifying session phase. Its rules and transitions are the practice
// machine's (`car-activity-timed/timed.ts`), its push kind `pushLap`.
import { carActivityQualifyingSpans } from '@pitwall/domain';
import { timedActivityMachine } from '../car-activity-timed/timed.ts';

export default timedActivityMachine(carActivityQualifyingSpans, 'qualifying', 'session-phase-qualifying', 'pushLap');
