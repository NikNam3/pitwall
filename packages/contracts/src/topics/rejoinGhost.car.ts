// One of our cars' rejoin ghost per condition: where it was `rejoin`'s stop cost ago, on every frame (SP4.3c §5.7, O18).
import type { RejoinGhost } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, RejoinGhost>({ owner: 'rejoin-ghost', mode: 'state', maxHz: 10, momentParams: eachCar });
