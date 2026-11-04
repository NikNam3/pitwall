import type { CarId, CarState } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export type CarOverview = {
  id: CarId;
  identity: CarState['identity'];
  /** The car's timing values without its confirmed laps (no signal, C13, C54). */
  timing: Omit<CarState['timing'], 'confirmedLaps'>;
  /** The live tyre values as the live state holds them: compounds and age. */
  tyres: Pick<CarState['tyres'], 'actualCompound' | 'visualCompound' | 'age'>;
  updatedAt: CarState['updatedAt'];
};

export default defineTopic<NoParams, CarOverview[]>({ owner: 'core', mode: 'state', maxHz: 10 });
