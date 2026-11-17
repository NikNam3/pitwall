import type { FeedId } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export type FeedStatus = {
  feedId: FeedId;
  connected: boolean;
  stale: boolean;
  lossPercent: number;
  latePackets: number;
  decodeErrors: number;
  packetsPerSecond: number;
  /** Median session-time step of closed frames: the rate of the menu-rate sources. */
  cadenceMs?: number;
  latencyMs?: number;
  wrongFormat?: number;
  /**
   * The feed's session ended and the rest of its packets are ignored (C59: ended by the user, or a key stored complete),
   * until a session of another key starts. The bridge always sets it; a value without it reads as `false`.
   */
  sessionEnded?: boolean;
  /**
   * From a session's end until the next session's first packet (SP4.3d spec §7.0 rule 2): the feed is between sessions,
   * not stale, and raises no `feed.stale` insight.
   */
  betweenSessions: boolean;
};

export default defineTopic<NoParams, FeedStatus>({ owner: 'core', mode: 'state', maxHz: 2 });
