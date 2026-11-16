// One of our cars' decision card (SP4.3d spec §6.3): per condition SC, VSC and GREEN (the out condition alone while one
// is out), staying out against boxing now onto each compound; a job's result (C51).
import type { ScCallBlocks } from '@pitwall/domain';
import type { Computed } from '../computed.ts';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, Computed<ScCallBlocks>>({ owner: 'sc-call', mode: 'state', maxHz: 1, momentParams: eachCar });
