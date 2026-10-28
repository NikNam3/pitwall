// Supervisor ruling: packet loss is not judged on a window with fewer than 60 closed frames (one second at 60 Hz).
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { FEED_MIN_LOSS_FRAMES, feedInsights } from '../../src/features/feed-status/feed-status.ts';
import { ScenarioBuilder } from '../../../../packages/engine/test/builders/index.ts';
import { viewFrom } from '../helpers/view.ts';

const f = 'udp-20777' as FeedId;
const frames = new ScenarioBuilder({ cars: 2 }).session().participants().frames(3, () => {}).build();
const keys = (o: object) => feedInsights(f, viewFrom(frames, o).feed, 0).map((i) => i.key);

describe('packet loss needs a minimum sample', () => {
  it('pins the minimum', () => { expect(FEED_MIN_LOSS_FRAMES).toBe(60); });
  it('raises nothing below 60 frames, even at 10 % loss', () => {
    expect(keys({ lossPercent: 10, lossWindowFrames: 59 })).toEqual([]);
    expect(keys({ lossPercent: 100, lossWindowFrames: 0 })).toEqual([]);
  });
  it('raises from 60 frames when loss is above 5 %', () => {
    expect(keys({ lossPercent: 5.01, lossWindowFrames: 60 })).toEqual(['feed.packetLoss']);
    expect(keys({ lossPercent: 10, lossWindowFrames: 600 })).toEqual(['feed.packetLoss']);
  });
  it('keeps the 5 % threshold on a big enough sample', () => {
    expect(keys({ lossPercent: 5, lossWindowFrames: 60 })).toEqual([]);
  });
  it('still reports stale and wrong format on a small sample', () => {
    expect(keys({ msSinceLastPacket: 2500, wrongFormat: 2024, lossPercent: 50, lossWindowFrames: 10 })).toEqual(['feed.stale', 'feed.wrongFormat']);
  });
});
