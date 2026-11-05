// Whether now is a good moment to talk to the driver: clear, or busy in or just before a braking zone (spec 6.3).
import type { TalkWindow } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, TalkWindow>({ owner: 'talk-window', mode: 'state', maxHz: 10, momentParams: eachCar });
