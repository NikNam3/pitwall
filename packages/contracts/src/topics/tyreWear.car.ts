// Per corner the tyre wear, its rate and the laps until the wear limit (spec 5.1).
import type { TyreWear } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, TyreWear>({ owner: 'tyre-wear', mode: 'state', maxHz: 4, momentParams: eachCar });
