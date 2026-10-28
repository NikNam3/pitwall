import type { CarDynamics } from '@pitwall/domain';
import { defineTopic, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, CarDynamics>({ mode: 'state', maxHz: 60 });
