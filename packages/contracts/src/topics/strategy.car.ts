// One of our cars' strategy table (SP4.3b spec §9, §10): its ranked policies and the run's metadata, the entry of
// `strategy.plans` for the car; a job's result (C51).
import type { StrategyCar } from '@pitwall/domain';
import type { Computed } from '../computed.ts';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, Computed<StrategyCar>>({ owner: 'strategy', mode: 'state', maxHz: 1, momentParams: eachCar });
