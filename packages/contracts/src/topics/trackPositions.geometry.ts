// The track map's outline, turn labels and sector starts (spec 6.1); `notApplicable` without a track file or an outline.
import type { Known, TrackGeometry } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, Known<TrackGeometry>>({ owner: 'track-positions', mode: 'state', maxHz: 1 });
