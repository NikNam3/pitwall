// Each car's pit stops, counted by `pit-stop-count` from the projection's pit-stop records (M7-R, C54): every car
// car-status has had in the session, ordered by car id.
import type { CarId } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export type PitStopCounts = { byCar: ReadonlyArray<{ carId: CarId; stops: number }> };

export default defineTopic<NoParams, PitStopCounts>({ owner: 'pit-stop-count', mode: 'state', maxHz: 4 });
