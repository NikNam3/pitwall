import type { CarId, CarState } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export type CarOverview = {
  id: CarId;
  identity: CarState['identity'];
  timing: CarState['timing'];
  tyres: Pick<CarState['tyres'], 'actualCompound' | 'visualCompound' | 'age'>;
  updatedAt: CarState['updatedAt'];
};

export default defineTopic<NoParams, CarOverview[]>({ mode: 'state', maxHz: 10 });
