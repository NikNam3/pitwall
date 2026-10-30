// "Out of the race": the one place an analysis asks whether a car will set no more times. It reads the car's current
// result status; a situations model (car situations as engine spans) may later answer it, and only this file changes.
import type { CarState, ResultStatus } from '@pitwall/domain';

const OUT_OF_RACE: ReadonlySet<ResultStatus> = new Set(['retired', 'didNotFinish', 'disqualified']);

/** Whether the car is out of the race now (retired, did not finish, disqualified): what it lacks will not come. */
export const outOfRace = (car: { timing: Pick<CarState['timing'], 'resultStatus'> }): boolean => OUT_OF_RACE.has(car.timing.resultStatus);
