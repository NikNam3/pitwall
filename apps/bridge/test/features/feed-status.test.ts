// apps/bridge/test/features/feed-status.test.ts
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { FEED_LOSS_PERCENT, FEED_STALE_MS, FEED_WINDOW_MS, feedInsights } from '../../src/features/feed-status/feed-status.ts';
import feedStatus from '../../src/features/feed-status/register.ts';
import { ScenarioBuilder } from '../../../../packages/engine/test/builders/index.ts';
import { viewFrom } from '../helpers/view.ts';

const f = 'udp-20777' as FeedId;
const frames = new ScenarioBuilder({ cars: 2 }).session().participants().frames(3, () => {}).build();
const feed = (o: object) => viewFrom(frames, o).feed;

describe('feed insights', () => {
  it('pins the thresholds', () => { expect([FEED_STALE_MS, FEED_LOSS_PERCENT, FEED_WINDOW_MS]).toEqual([2000, 5, 10_000]); });
  it('feed.stale: advisory from 2000 ms without packets', () => {
    expect(feedInsights(f, feed({ msSinceLastPacket: 1999 }), 0)).toEqual([]);
    expect(feedInsights(f, feed({ msSinceLastPacket: 2000 }), 42)).toEqual([
      { key: 'feed.stale', severity: 'advisory', category: 'feed', feedId: f, kind: 'feed.stale', params: { msSinceLastPacket: 2000 }, raisedAt: 42 }]);
  });
  it('feed.packetLoss: advisory above 5 % incomplete frames', () => {
    expect(feedInsights(f, feed({ lossPercent: 5 }), 0)).toEqual([]);
    expect(feedInsights(f, feed({ lossPercent: 5.01 }), 7)).toEqual([
      { key: 'feed.packetLoss', severity: 'advisory', category: 'feed', feedId: f, kind: 'feed.packetLoss', params: { lossPercent: 5.01 }, raisedAt: 7 }]);
  });
  it('feed.wrongFormat: critical with the received format', () => {
    expect(feedInsights(f, feed({ wrongFormat: 2024 }), 0)).toEqual([
      { key: 'feed.wrongFormat', severity: 'critical', category: 'feed', feedId: f, kind: 'feed.wrongFormat', params: { format: 2024 }, raisedAt: 0 }]);
  });
  it('orders stale, packetLoss, wrongFormat', () => {
    expect(feedInsights(f, feed({ msSinceLastPacket: 3000, lossPercent: 50, wrongFormat: 2023 }), 0).map((i) => i.key))
      .toEqual(['feed.stale', 'feed.packetLoss', 'feed.wrongFormat']);
  });
  it('feed.status topic value', () => {
    const calc = feedStatus.calculators.find((c) => c.id === 'feed.status') as QuickCalculator<unknown>;
    const v = viewFrom(frames, { msSinceLastPacket: 2500, lossPercent: 1.5, latePackets: 3, packetsPerSecond: 58 });
    expect(calc.compute(v)).toEqual({ feedId: v.state.feedId, connected: true, stale: true, lossPercent: 1.5, latePackets: 3, decodeErrors: 0, packetsPerSecond: 58 });
    expect(feedStatus.topics).toEqual([{ topic: 'feed.status', from: 'feed.status' }]);
  });
});
