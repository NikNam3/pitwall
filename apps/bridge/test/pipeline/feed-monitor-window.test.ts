import { describe, expect, it } from 'vitest';
import type { FrameMetrics } from '@pitwall/engine';
import { FeedMonitor } from '../../src/pipeline/feed-monitor.ts';

const m = (framesClosed: number, incompleteFrames: number): FrameMetrics => ({ framesClosed, incompleteFrames, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0 });

describe('FeedMonitor loss window size', () => {
  it('counts the closed frames the loss is measured over', () => {
    const f = new FeedMonitor();
    f.sample(m(100, 0), 0); f.sample(m(200, 10), 5000); f.sample(m(300, 10), 11_000);
    expect(f.view(m(300, 10), 11_000).lossWindowFrames).toBe(200);
    expect(f.view(m(300, 10), 16_000).lossWindowFrames).toBe(100);
  });
  it('is the frames since the start while the window is not yet full', () => {
    const f = new FeedMonitor();
    expect(f.view(m(18, 1), 300)).toMatchObject({ lossWindowFrames: 18 });
  });
});
