import type { CarId, CarState } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export type CarOverview = {
  id: CarId;
  identity: CarState['identity'];
  /** The game's timing as sent (`numPitStops` is the game's count; `stops` is the reconciled one). */
  timing: CarState['timing'];
  /** `visualCompound` is the live one, or the car's latest stint record's while the game sends `unknown`. */
  tyres: Pick<CarState['tyres'], 'actualCompound' | 'visualCompound' | 'age'>;
  /** Pit stops so far: the larger of the car's pit-stop records and the game's count. */
  stops: number;
  updatedAt: CarState['updatedAt'];
};

export default defineTopic<NoParams, CarOverview[]>({ owner: 'core', mode: 'state', maxHz: 10 });
