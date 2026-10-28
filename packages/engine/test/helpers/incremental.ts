// Every incremental calculator's test calls this: updating step by step must equal initialising from scratch (spec 7.3).
import { feedId } from '@pitwall/domain';
import { expect } from 'vitest';
import { SessionRunner, type EngineView, type FeedMetricsView, type Frame, type IncrementalCalculator } from '../../src/index.ts';

export const IDLE_FEED: FeedMetricsView = {
  framesClosed: 0,
  incompleteFrames: 0,
  latePackets: 0,
  droppedBeforeSession: 0,
  droppedUid0: 0,
  decodeErrors: 0,
  packetsPerSecond: 0,
  connected: true,
  msSinceLastPacket: 0,
  lossPercent: 0,
};

/** Replays `frames`, keeping the accumulator the way the scheduler does, and compares it to a fresh `init` after each frame. */
export function expectIncrementalEqualsFromScratch<Acc, Out>(
  calc: IncrementalCalculator<Acc, Out>,
  frames: readonly Frame[],
  feed: FeedMetricsView = IDLE_FEED,
): void {
  const first = frames.find((frame) => frame.session !== undefined);
  if (first?.session === undefined) throw new Error('expectIncrementalEqualsFromScratch: no frame carries a session');
  const runner = new SessionRunner({ feedId: feedId('test'), sessionUid: first.sessionUid, session: first.session });

  let acc: { value: Acc } | undefined;
  frames.forEach((frame, i) => {
    const { state, changed, delta } = runner.apply(frame);
    const view: EngineView = { state, changed, delta, feed, outputs: new Map() };
    acc = acc === undefined || delta.truncated ? { value: calc.init(view) } : { value: calc.update(acc.value, delta, view) };
    expect(calc.output(acc.value), `frame ${i}`).toEqual(calc.output(calc.init(view)));
  });
}
