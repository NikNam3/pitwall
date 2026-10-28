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
};

export default defineTopic<NoParams, FeedStatus>({ owner: 'core', mode: 'state', maxHz: 2 });
