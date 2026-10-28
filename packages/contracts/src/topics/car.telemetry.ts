import type { CarDynamics, CarMotion, Known } from '@pitwall/domain';
import { defineTopic, type CarParams } from '../topic-def.ts';

/** One car's world motion and driving inputs. */
export type CarTelemetry = { motion: CarMotion; dynamics: Known<CarDynamics> };

export default defineTopic<CarParams, CarTelemetry>({ mode: 'state', maxHz: 60 });
