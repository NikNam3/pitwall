import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { PacketId, type Packet } from '@pitwall/protocol';
import { FrameAssembler, type Frame } from '../../src/index.ts';
import { menuGroup, stub } from './stub-packet.ts';

const feedId = 'test' as FeedId;
const pushAll = (a: FrameAssembler, ps: Packet[]) => ps.flatMap((p) => a.push(p));
const ids = (fs: Frame[]) => fs.map((f) => f.frameId);

describe('FrameAssembler', () => {
  it('groups one frame into named slots', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(10, 1.0), stub('session', 10, 1.0), stub('participants', 10, 1.0)]);
    const f = a.flush()[0]!;
    expect(f).toMatchObject({ feedId, sessionUid: 7n, frameId: 10, overallFrameId: 10, sessionTime: 1000, playerCarIndex: 0 });
    for (const k of ['motion', 'lapData', 'telemetry', 'status', 'motionEx', 'session', 'participants'] as const) expect(f[k]).toBeDefined();
    expect(f.damage).toBeUndefined();
    expect([f.sessionHistory, f.tyreSets, f.events]).toEqual([[], [], []]);
  });
  it('closes frame N only when a packet for N+3 arrives', () => {
    const a = new FrameAssembler({ feedId });
    expect(pushAll(a, [...menuGroup(10, 1.0), ...menuGroup(11, 1.016), ...menuGroup(12, 1.032)])).toEqual([]);
    expect(ids(a.push(stub('lapData', 13, 1.048)))).toEqual([10]);
  });
  it('merges a packet for N that arrives after N+1 and N+2', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [stub('motion', 10, 1.0), stub('motion', 11, 1.016), stub('motion', 12, 1.032), stub('lapData', 10, 1.0)]);
    expect(a.flush()[0]!.lapData).toBeDefined();
    expect(a.metrics.latePackets).toBe(0);
  });
  it('drops and counts a packet more than 2 behind the newest; 2 behind is still accepted', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(10, 1.0), stub('motion', 13, 1.048)]);
    expect(a.push(stub('lapData', 10, 1.0))).toEqual([]);
    a.push(stub('lapData', 11, 1.016));
    expect(a.metrics.latePackets).toBe(1);
    expect(ids(a.flush())).toEqual([11, 13]);
  });
  it('does not count frameId gaps of 2 as loss', () => {
    const a = new FrameAssembler({ feedId });
    const out = [10, 12, 14, 16].flatMap((n, i) => pushAll(a, menuGroup(n, 1 + i * 0.016)));
    expect(ids([...out, ...a.flush()])).toEqual([10, 12, 14, 16]);
    expect(a.metrics).toMatchObject({ framesClosed: 4, incompleteFrames: 0, latePackets: 0 });
  });
  it('counts frames missing any menu-rate packet as incomplete', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, menuGroup(1, 0.016));
    (['lapData', 'motion', 'carTelemetry', 'carStatus', 'motionEx'] as const).forEach((skip, i) =>
      pushAll(a, menuGroup(2 + i, 0.032 + i * 0.016).filter((p) => p.packetId !== PacketId[skip])));
    a.flush();
    expect(a.metrics).toMatchObject({ framesClosed: 6, incompleteFrames: 5 });
  });
  it('appends multi-instance packets in arrival order; last single-instance packet wins; max session time in int ms', () => {
    const a = new FrameAssembler({ feedId });
    const last = stub('lapData', 5, 12.3456);
    pushAll(a, [stub('sessionHistory', 5, 12.3, { carIdx: 3 }), stub('event', 5, 12.3, { code: 'OVTK' }), stub('lapData', 5, 12.3401),
      stub('sessionHistory', 5, 12.3, { carIdx: 4 }), stub('tyreSets', 5, 12.3, { carIdx: 1 }), stub('tyreSets', 5, 12.3, { carIdx: 2 }),
      stub('event', 5, 12.3, { code: 'BUTN' }), last]);
    const f = a.flush()[0]!;
    expect(f.sessionHistory.map((p) => p.carIdx)).toEqual([3, 4]);
    expect(f.tyreSets.map((p) => p.carIdx)).toEqual([1, 2]);
    expect(f.events.map((p) => p.details.code)).toEqual(['OVTK', 'BUTN']);
    expect(f.lapData).toBe(last);
    expect(f.sessionTime).toBe(12346);
  });
  it('cadence is the median of positive steps (variable 12–20 ms)', () => {
    const a = new FrameAssembler({ feedId });
    expect(a.metrics.cadenceMs).toBeUndefined();
    [0, 12, 32, 32, 45, 64, 80].forEach((ms, i) => pushAll(a, menuGroup(i, ms / 1000)));
    a.flush();
    expect(a.metrics).toMatchObject({ cadenceMs: 16, lastSessionTime: 80 });   // steps 12, 20, (0 skipped), 13, 19, 16
  });
  it('cadence looks at the last 64 positive steps only', () => {
    const a = new FrameAssembler({ feedId });
    let t = 0;
    for (let i = 0; i < 91; i++) { pushAll(a, menuGroup(i, t / 1000)); t += i < 50 ? 20 : 12; }
    a.flush();
    expect(a.metrics.cadenceMs).toBe(12);   // over all 90 steps the median would be 20
  });
  it('orders by overallFrameId, so a flashback (frameId back, overall up) is not late', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(100, 2.0), ...menuGroup(101, 2.016)]);
    const out = [40, 41, 42].flatMap((n, i) => pushAll(a, menuGroup(n, 0.7 + i * 0.016, { overall: 102 + i })));
    expect([...out, ...a.flush()].map((f) => [f.frameId, f.overallFrameId])).toEqual([[100, 100], [101, 101], [40, 102], [41, 103], [42, 104]]);
    expect(a.metrics.latePackets).toBe(0);
  });
  it('attach() merges into the newest open frame whatever the packet frame id', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(4137, 63.3), ...menuGroup(4138, 63.318)]);
    a.attach(stub('sessionHistory', 4138, 63.318, { uid: 0n, carIdx: 5 }));
    a.attach(stub('event', 0, 63.318, { code: 'SEND' }));
    const fs = a.flush();
    expect(ids(fs)).toEqual([4137, 4138]);
    expect(fs[1]!.events.map((e) => e.details.code)).toEqual(['SEND']);
    expect(fs[1]!.sessionHistory[0]!.header.sessionUid).toBe(0n);
    expect(a.metrics.latePackets).toBe(0);
  });
});
