// Every competing car on the track map and the marshal zones' flags (spec 6.1); `notApplicable` without a track file or an outline.
import type { Known, TrackCars } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, Known<TrackCars>>({ owner: 'track-positions', mode: 'state', maxHz: 10 });
