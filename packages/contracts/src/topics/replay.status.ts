import { defineTopic, type NoParams } from '../topic-def.ts';

/** Where a jump goes: the first frame at or past the lap or the session time. */
export type ReplayJump = { kind: 'lap'; lap: number } | { kind: 'time'; sessionTimeMs: number };

/** Where a replay feed is and how it plays (spec 8.5). Published by the replay controller, not a feature. */
export type ReplayStatus = {
  paused: boolean;
  /** Playback factor: 1 is the recorded pace. Nominal while `unpaced`: the factor the first speed change would replace. */
  speed: number;
  sessionTimeMs: number;
  playerLap: number;
  atEnd: boolean;
  /** Present (and true) while the replay plays without waiting between records, as fast as it can (`pitwall replay` without `--realtime` or `--speed`); `speed` is then not the real pace. */
  unpaced?: true;
  /**
   * Present while a jump fast-forwards to its target; `sessionTimeMs` and `playerLap` are then the fast-forward's
   * progress (a jump back starts again from lap 1).
   */
  jumpingTo?: ReplayJump;
  /** Set when a jump went past the end of the recording and stopped at the last frame. */
  note?: 'beyondEnd';
};

export default defineTopic<NoParams, ReplayStatus>({ owner: 'core', mode: 'state', maxHz: 4 });
