// One of our cars' pit window: the fitted set's latest stop lap and, per compound we may fit, its window (SP4.2 spec 3.4).
import type { Known, PitWindow } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, Known<PitWindow>>({ owner: 'pit-window', mode: 'state', maxHz: 4, momentParams: eachCar });
