// Fuel, burn, margin in laps and save target (spec 5.2).
import type { FuelState } from '@pitwall/domain';
import { defineTopic, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, FuelState>({ owner: 'fuel', mode: 'state', maxHz: 4 });
