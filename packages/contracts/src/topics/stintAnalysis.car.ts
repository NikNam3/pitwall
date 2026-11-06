// Per car the stints, their laps and the degradation fit with its band, for the stint scatter (spec 5); our cars only.
import type { StintAnalysis } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, StintAnalysis>({ owner: 'stint-analysis', mode: 'state', maxHz: 1, momentParams: eachCar });
