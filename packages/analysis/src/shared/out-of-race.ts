// "Out of the race": the one place that decides whether a car will set no more times. It reads the car's current
// result status against the domain's `OUT_OF_RACE_STATUSES`. Displays take the answer from the analyses (the timing
// tower reads `LapBoardRow.outOfRace`), so when a situations model (car situations as engine spans) answers it, only
// this file changes.
import { OUT_OF_RACE_STATUSES, type CarState } from '@pitwall/domain';

/** Whether the car is out of the race now (retired, did not finish, disqualified, not classified): what it lacks will not come. */
export const outOfRace = (car: { timing: Pick<CarState['timing'], 'resultStatus'> }): boolean => OUT_OF_RACE_STATUSES.has(car.timing.resultStatus);
