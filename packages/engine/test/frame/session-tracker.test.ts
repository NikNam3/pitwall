import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { Packet } from '@pitwall/protocol';
import { SessionTracker, type TrackerEvent } from '../../src/index.ts';
import { menuGroup, stub } from './stub-packet.ts';

type FrameEvent = Extract<TrackerEvent, { type: 'frame' }>;
const feedId = 'test' as FeedId;
const A = 0xaaaan;
const B = 0xbbbbn;
const feed = (t: SessionTracker, ps: Packet[], at: number) => ps.flatMap((p) => t.push(p, at));
const kinds = (es: TrackerEvent[]) => es.map((e) => (e.type === 'sessionEnded' ? `ended:${e.reason}` : e.type));
// session A with complete frames 1 and 2, received at 900 ms
const ended = () => {
  const t = new SessionTracker({ feedId });
  feed(t, [stub('session', 1, 0, { uid: A }), ...menuGroup(1, 0.016, { uid: A }), ...menuGroup(2, 0.032, { uid: A })], 900);
  return t;
};

describe('SessionTracker', () => {
  it('opens no session before the first Session packet with uid != 0', () => {
    const t = new SessionTracker({ feedId });
    expect(feed(t, [stub('event', 0, 0, { uid: A }), ...menuGroup(0, 0, { uid: A }), stub('session', 0, 0, { uid: 0n })], 0)).toEqual([]);
    expect(t.metrics).toMatchObject({ droppedBeforeSession: 6, droppedUid0: 1 });
    expect(t.push(stub('session', 1, 0.016, { uid: A }), 100)).toEqual([
      { type: 'sessionStarted', sessionUid: A, session: expect.objectContaining({ packetId: 1 }), receivedAtMs: 100 },
    ]);
  });
  it('emits frames of the open session and ends with streamEnd', () => {
    const t = new SessionTracker({ feedId });
    const es = [1, 2, 3, 4].flatMap((n) =>
      feed(t, [...(n === 1 ? [stub('session', 1, 0, { uid: A })] : []), ...menuGroup(n, n * 0.016, { uid: A })], n * 16),
    );
    expect(kinds(es)).toEqual(['sessionStarted', 'frame']);
    expect(es[1]).toMatchObject({ type: 'frame', sessionUid: A, frame: { frameId: 1 } });
    expect(kinds(t.end())).toEqual(['frame', 'frame', 'frame', 'ended:streamEnd']);
  });
  it('drops another uid without a Session packet; a new uid with one replaces the session', () => {
    const t = ended();
    expect(t.push(stub('lapData', 3, 0.048, { uid: B }), 950)).toEqual([]);
    expect(t.metrics.droppedBeforeSession).toBe(1);
    const es = t.push(stub('session', 0, 0, { uid: B }), 1000);
    expect(es.map((e) => [e.type, e.sessionUid])).toEqual([
      ['frame', A],
      ['frame', A],
      ['sessionEnded', A],
      ['sessionStarted', B],
    ]);
    expect(es[2]).toMatchObject({ reason: 'replaced' });
  });
  it('after SEND, uid-0 packets within 10 s join the ended session; the first packet after 10 s closes it', () => {
    const t = ended();
    expect(t.push(stub('event', 0, 0.032, { uid: A, code: 'SEND' }), 1000)).toEqual([]);
    expect(t.push(stub('finalClassification', 0, 0.032, { uid: 0n }), 4000)).toEqual([]);
    expect(t.push(stub('sessionHistory', 0, 0.032, { uid: 0n, carIdx: 3 }), 11_000)).toEqual([]);
    const es = t.push(stub('sessionHistory', 0, 0.032, { uid: 0n, carIdx: 4 }), 11_001);
    expect(kinds(es)).toEqual(['frame', 'frame', 'ended:SEND']);
    const last = (es[1] as FrameEvent).frame;
    expect(last.frameId).toBe(2);
    expect(last.finalClassification).toBeDefined();
    expect(last.sessionHistory.map((p) => p.carIdx)).toEqual([3]);
    expect(last.events.map((e) => e.details.code)).toEqual(['SEND']);
    expect(t.metrics).toMatchObject({ droppedUid0: 1, latePackets: 0 });
  });
  it('keeps uid-0 packets received up to 10 s before SEND (fixture order: bulk, then SEND)', () => {
    const t = ended();
    t.push(stub('sessionHistory', 2, 0.032, { uid: 0n, carIdx: 1 }), 900);
    t.push(stub('sessionHistory', 2, 0.032, { uid: 0n, carIdx: 2 }), 5000);
    t.push(stub('event', 0, 0.032, { uid: A, code: 'SEND' }), 10_901);
    const es = t.end();
    expect(kinds(es)).toEqual(['frame', 'frame', 'ended:SEND']);
    expect((es[1] as FrameEvent).frame.sessionHistory.map((p) => p.carIdx)).toEqual([2]);
    expect(t.metrics.droppedUid0).toBe(1);
  });
  it('drops uid-0 packets of a session that never sees SEND', () => {
    const t = ended();
    t.push(stub('sessionHistory', 2, 0.032, { uid: 0n }), 950);
    const es = t.end();
    expect(kinds(es)).toEqual(['frame', 'frame', 'ended:streamEnd']);
    expect((es[1] as FrameEvent).frame.sessionHistory).toEqual([]);
    expect(t.metrics.droppedUid0).toBe(1);
  });
  it('a new session inside the grace window first ends the old one with SEND; metrics add up', () => {
    const t = ended();
    t.push(stub('event', 0, 0.032, { uid: A, code: 'SEND' }), 1000);
    const es = t.push(stub('session', 0, 0, { uid: B }), 2000);
    expect(es.map((e) => [e.type, e.sessionUid])).toEqual([
      ['frame', A],
      ['frame', A],
      ['sessionEnded', A],
      ['sessionStarted', B],
    ]);
    expect(es[2]).toMatchObject({ reason: 'SEND' });
    expect(kinds(t.end())).toEqual(['frame', 'ended:streamEnd']);
    expect(t.metrics).toMatchObject({ framesClosed: 3, incompleteFrames: 1 }); // B's frame 0 holds only the Session packet
  });
});
