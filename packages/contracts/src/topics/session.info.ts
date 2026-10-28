import type { CarId, FeedId, SessionState, SessionUid } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export type SessionInfo = {
  feedId: FeedId;
  sessionUid: SessionUid;
  playerCar: CarId;
  teammateCar?: CarId;
  session: SessionState;
  /** Realism mode is on for this session (spec 7.9); fixed from the session's start. */
  realism: boolean;
};

export default defineTopic<NoParams, SessionInfo>({ owner: 'core', mode: 'state', maxHz: 2 });
