// The race moment: what matters now, and since when (spec 7); `notApplicable` outside the race.
import type { Known, RaceMoment } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, Known<RaceMoment>>({ owner: 'race-moment', mode: 'state', maxHz: 4 });
