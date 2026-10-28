import { defineTopic, type NoParams } from '../topic-def.ts';

/** Where a replay feed is and how it plays (spec 8.5). Published by the replay controller, not a feature. */
export type ReplayStatus = {
  paused: boolean;
  /** Playback factor: 1 is the recorded pace. */
  speed: number;
  sessionTimeMs: number;
  playerLap: number;
  atEnd: boolean;
  /** Set when a jump went past the end of the recording and stopped at the last frame. */
  note?: 'beyondEnd';
};

export default defineTopic<NoParams, ReplayStatus>({ owner: 'core', mode: 'state', maxHz: 4 });
