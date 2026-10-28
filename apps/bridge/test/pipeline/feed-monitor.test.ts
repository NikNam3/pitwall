import { describe, expect, it } from 'vitest';
import type { FrameMetrics } from '@pitwall/engine';
import { FeedMonitor } from '../../src/pipeline/feed-monitor.ts';
const m = (framesClosed: number, incompleteFrames: number): FrameMetrics => ({ framesClosed, incompleteFrames, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0 });

describe('FeedMonitor', () => {
  it('packets per second over the last 1000 ms, time since last packet', () => {
    const f = new FeedMonitor(); for (let t = 10; t <= 1000; t += 10) f.onPacket(t);
    expect(f.view(m(0, 0), 1000)).toMatchObject({ packetsPerSecond: 100, msSinceLastPacket: 0, connected: true });
    expect(f.view(m(0, 0), 1500)).toMatchObject({ packetsPerSecond: 50, msSinceLastPacket: 500 });
    expect(new FeedMonitor().view(m(0, 0), 5000)).toMatchObject({ connected: false, msSinceLastPacket: 0, packetsPerSecond: 0 });
  });
  it('loss % = incomplete / closed frames over the last 10 s', () => {
    const f = new FeedMonitor(); f.onPacket(0);
    f.sample(m(100, 0), 0); f.sample(m(200, 10), 5000); f.sample(m(300, 10), 11_000);
    expect(f.view(m(300, 10), 11_000).lossPercent).toBe(5);
    expect(f.view(m(300, 10), 16_000).lossPercent).toBe(0);
  });
  it('wrong format is reported for 10 s and counted as decode error', () => {
    const f = new FeedMonitor(); f.onPacket(1000); f.onDecodeError({ kind: 'wrongFormat', format: 2024 }, 1000);
    expect(f.view(m(0, 0), 1000)).toMatchObject({ wrongFormat: 2024, decodeErrors: 1 });
    expect(f.view(m(0, 0), 11_001).wrongFormat).toBeUndefined();
  });
  it('passes the tracker metrics through to the view', () => {
    const f = new FeedMonitor(); f.onPacket(0);
    const metrics: FrameMetrics = { framesClosed: 7, incompleteFrames: 1, latePackets: 2, droppedBeforeSession: 3, droppedUid0: 4, decodeErrors: 0 };
    expect(f.view(metrics, 0)).toMatchObject(metrics);
  });
  it('windowMs sets the window of the loss and the wrong-format report', () => {
    const f = new FeedMonitor({ windowMs: 1000 }); f.onPacket(0); f.onDecodeError({ kind: 'wrongFormat', format: 2024 }, 0);
    f.sample(m(100, 0), 0); f.sample(m(200, 20), 500); f.sample(m(300, 20), 1200);
    expect(f.view(m(300, 20), 1200).lossPercent).toBeCloseTo(10, 5);
    expect(f.view(m(300, 20), 1001).wrongFormat).toBeUndefined();
  });
});
