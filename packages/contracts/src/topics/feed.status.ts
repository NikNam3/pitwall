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
  latencyMs?: number;
  wrongFormat?: number;
};

export default defineTopic<NoParams, FeedStatus>({ mode: 'state', maxHz: 2 });
