// The planning job's result for one of our cars (SP4.3d spec §7.1 step 4, §7.4): the same value as `strategy.car`, so
// the boards and the table switch topic names only; a job result outside the determinism hash, published by the
// bridge's planning module (C51, C55).
import type { StrategyCar } from '@pitwall/domain';
import type { Computed } from '../computed.ts';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, Computed<StrategyCar>>({ owner: 'core', scope: 'feed', mode: 'state', maxHz: 1, momentParams: eachCar });
