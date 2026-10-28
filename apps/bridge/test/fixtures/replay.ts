// Frames are folded, never collected (TT has 71 448).
import type { FeedId } from '@pitwall/domain';
import { decode, type Packet } from '@pitwall/protocol';
import { SessionTracker, type Frame, type FrameMetrics, type TrackerEvent } from '@pitwall/engine';
import { fixturePath, type FixtureName } from '../../../../test-support/fixtures.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';

export async function* fixturePackets(name: FixtureName): AsyncGenerator<{ packet: Packet; receivedAtMs: number }> {
  for await (const r of readPwrec(fixturePath(name)!)) {
    const d = decode(r.payload);
    if (d.ok) yield { packet: d.packet, receivedAtMs: r.t };
  }
}

export type TrackedFixture = {
  lifecycle: Array<Exclude<TrackerEvent, { type: 'frame' }>>;
  frames: number;
  lastFrame: Frame | undefined;
  metrics: FrameMetrics;
};

export async function trackFixture(name: FixtureName, onFrame: (f: Frame) => void = () => {}): Promise<TrackedFixture> {
  const tracker = new SessionTracker({ feedId: name as string as FeedId });
  const out: TrackedFixture = { lifecycle: [], frames: 0, lastFrame: undefined, metrics: tracker.metrics };
  const take = (es: TrackerEvent[]) => {
    for (const e of es) {
      if (e.type === 'frame') {
        out.frames++;
        out.lastFrame = e.frame;
        onFrame(e.frame);
      } else out.lifecycle.push(e);
    }
  };
  for await (const { packet, receivedAtMs } of fixturePackets(name)) take(tracker.push(packet, receivedAtMs));
  take(tracker.end());
  return { ...out, metrics: tracker.metrics };
}
