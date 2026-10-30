import type { CarDynamics, CarMotion, Known } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

/** One car's world motion and driving inputs. */
export type CarTelemetry = { motion: CarMotion; dynamics: Known<CarDynamics> };

export default defineTopic<CarParams, CarTelemetry>({ owner: 'core', mode: 'state', maxHz: 60, momentParams: eachCar });
