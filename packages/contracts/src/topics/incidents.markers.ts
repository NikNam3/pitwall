// The major incidents of the last laps as track-map markers (spec 6.2); `notApplicable` without a track file or an outline.
import type { Known, MapIncident } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, Known<MapIncident[]>>({ owner: 'incidents', mode: 'state', maxHz: 1 });
