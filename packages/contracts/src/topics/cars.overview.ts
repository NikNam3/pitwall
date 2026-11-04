import type { CarId, CarState } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export type CarOverview = {
  id: CarId;
  identity: CarState['identity'];
  /** The car's timing values without its confirmed laps (no signal, C13, C54). */
  timing: Omit<CarState['timing'], 'confirmedLaps'>;
  /** `visualCompound` is the live one, or the car's latest stint record's while the game sends `unknown`. */
  tyres: Pick<CarState['tyres'], 'actualCompound' | 'visualCompound' | 'age'>;
  /** Pit stops so far: the car's pit-stop records. */
  stops: number;
  updatedAt: CarState['updatedAt'];
};

export default defineTopic<NoParams, CarOverview[]>({ owner: 'core', mode: 'state', maxHz: 10 });
