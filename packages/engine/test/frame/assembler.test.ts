import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { PacketId, type EventCode, type Packet } from '@pitwall/protocol';
import { FrameAssembler, type Frame } from '../../src/index.ts';
import { buildPacket } from '../builders/index.ts';
import { menuGroup, stub } from './stub-packet.ts';

const feedId = 'test' as FeedId;
/** Pushes a packet received at its own header session time (wall clock = session time unless a test says otherwise). */
const push = (a: FrameAssembler, p: Packet, receivedAtMs = p.header.sessionTime * 1000) => a.push(p, receivedAtMs);
const pushAll = (a: FrameAssembler, ps: Packet[]) => ps.flatMap((p) => push(a, p));
const ids = (fs: Frame[]) => fs.map((f) => f.frameId);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

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
  it('a frame carries the receive time of its first packet', () => {
    const a = new FrameAssembler({ feedId });
    push(a, stub('motion', 10, 1.0), 5_000);
    push(a, stub('lapData', 10, 1.0), 5_004);
    push(a, stub('motion', 11, 1.016), 5_016);
    expect(a.flush().map((f) => [f.frameId, f.receivedAtMs])).toEqual([[10, 5_000], [11, 5_016]]);
  });
  it('closes frame N only when a packet for N+3 arrives', () => {
    const a = new FrameAssembler({ feedId });
    expect(pushAll(a, [...menuGroup(10, 1.0), ...menuGroup(11, 1.016), ...menuGroup(12, 1.032)])).toEqual([]);
    expect(ids(push(a, stub('lapData', 13, 1.048)))).toEqual([10]);
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
    expect(push(a, stub('lapData', 10, 1.0))).toEqual([]);
    push(a, stub('lapData', 11, 1.016));
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
  // raceZandvoortUidReuse (a reused session uid): right after every real LapPositions packet (1 Hz) the game sends one
  // whose header is frozen at frame 10539, session time 33.337 s, from the start of the session on.
  describe('a packet type with a frozen header far ahead of the others', () => {
    const FROZEN = 10_539;
    const frozen = (overall = FROZEN) => stub('lapPositions', overall, 33.337, { overall });
    /** Frames `from`..`to` at 16 ms; on every `lapEvery`-th frame a real LapPositions, then the frozen one. */
    const stream = (from: number, to: number, o: { lapEvery: number; frozenAt?: number }) =>
      range(from, to).flatMap((n) => [
        ...menuGroup(n, n * 0.016),
        ...(n % o.lapEvery === 0 ? [stub('lapPositions', n, n * 0.016), frozen(o.frozenAt)] : []),
      ]);
    const all = (a: FrameAssembler, ps: Packet[]) => [...pushAll(a, ps), ...a.flush()];
    /** The frames that carry a LapPositions packet, with that packet's header frame id. */
    const lapPositionsOf = (fs: Frame[]) =>
      fs.flatMap((f) => (f.lapPositions ? [[f.overallFrameId, f.lapPositions.header.overallFrameIdentifier]] : []));

    it("packets whose header frame id lags behind a stale packet type's frozen header are not dropped as late", () => {
      const a = new FrameAssembler({ feedId });
      const fs = all(a, [stub('session', 0, 0), ...stream(0, 129, { lapEvery: 60 })]);
      expect(ids(fs)).toEqual(range(0, 129));
      expect(a.metrics).toMatchObject({ framesClosed: 130, incompleteFrames: 0 });
      // each LapPositions slot holds the frame's own packet, never the frozen one
      expect(lapPositionsOf(fs)).toEqual([[0, 0], [60, 60], [120, 120]]);
    });
    it("a frozen packet right after a session's first packet does not hide the frames after it", () => {
      const a = new FrameAssembler({ feedId });
      const fs = all(a, [stub('session', 0, 0), frozen(), ...stream(0, 69, { lapEvery: 60 })]);
      expect(ids(fs)).toEqual(range(0, 69));
      expect(a.metrics).toMatchObject({ framesClosed: 70, incompleteFrames: 0 });
      expect(lapPositionsOf(fs)).toEqual([[0, 0], [60, 60]]);
    });
    it('frames still close while the frozen packets keep coming: frame N once a packet for N+3 arrived', () => {
      const a = new FrameAssembler({ feedId });
      pushAll(a, stream(0, 60, { lapEvery: 60 }));
      expect(ids(pushAll(a, menuGroup(61, 0.976)))).toEqual([58]);
    });
    it('once the others pass the frozen frame id, the frozen packets are late; no frame takes one in', () => {
      const a = new FrameAssembler({ feedId });
      const fs = all(a, stream(0, 200, { lapEvery: 30, frozenAt: 100 }));
      expect(ids(fs)).toEqual(range(0, 200));
      expect(a.metrics).toMatchObject({ framesClosed: 201, incompleteFrames: 0 });
      expect(lapPositionsOf(fs)).toEqual([0, 30, 60, 90, 120, 150, 180].map((n) => [n, n]));
    });
  });
  it('a jump of every packet type is no frozen header: the frames before it close, the ones after it are whole, a straggler is late', () => {
    const a = new FrameAssembler({ feedId });
    const closed = pushAll(a, [...menuGroup(10, 1.0), ...menuGroup(11, 1.016), ...menuGroup(500, 8.856), ...menuGroup(501, 8.872)]);
    expect(ids(closed)).toEqual([10, 11]);
    expect(push(a, stub('lapData', 11, 1.016))).toEqual([]);
    expect(a.metrics.latePackets).toBe(1);
    expect(ids(a.flush())).toEqual([500, 501]);
    expect(a.metrics).toMatchObject({ framesClosed: 4, incompleteFrames: 0 });
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

describe('FrameAssembler: the flashback report', () => {
  /** An FLBK event of frame `frameId` back to frame 7 at 0.5 s. */
  const flbk = (frameId: number, sessionTimeS: number) =>
    buildPacket('event', {
      header: { sessionUid: 7n, sessionTime: sessionTimeS, frameIdentifier: frameId, overallFrameIdentifier: frameId },
      details: { code: 'FLBK', flashbackFrameIdentifier: 7, flashbackSessionTime: 0.5 },
    });

  it("a frame with an FLBK event carries its target: the game's frame id and session time in ms", () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(10, 1.0), flbk(10, 1.0)]);
    expect(a.flush()[0]!.flashback).toEqual({ targetFrameId: 7, targetSessionTime: 500 });
  });
  it('a frame without one carries none', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(10, 1.0), stub('event', 10, 1.0, { code: 'SSTA' })]);
    expect(a.flush()[0]!.flashback).toBeUndefined();
  });
});

// C5, inventory 1.10: the game sends the flashback frame under one `overallFrameIdentifier` for two ticks: the undone old
// tick (its own frame id and session time, events only, the FLBK among them) and the first tick of the new timeline
// (frame id at the target). On some flashbacks the new tick's first packets are events with the new frame id and the OLD
// session time.
describe('FrameAssembler: one frame per game tick (C5)', () => {
  const OVERALL = 42_053;
  const OLD = 42_053;
  const NEW = 41_153;
  const old = (code: EventCode) => stub('event', OLD, 496.561, { overall: OVERALL, code });
  const flbkOf = (frameId: number, overall: number, sessionTimeS: number, target: number, targetS: number) =>
    buildPacket('event', {
      header: { sessionUid: 7n, sessionTime: sessionTimeS, frameIdentifier: frameId, overallFrameIdentifier: overall },
      details: { code: 'FLBK', flashbackFrameIdentifier: target, flashbackSessionTime: targetS },
    });
  const oldTick = () => [old('PENA'), old('OVTK'), old('SCAR'), old('DRSD'), flbkOf(OLD, OVERALL, 496.561, NEW, 481.561)];
  const newTick = () => [
    stub('session', NEW, 484.014, { overall: OVERALL }),
    stub('participants', NEW, 484.014, { overall: OVERALL }),
    ...menuGroup(NEW, 484.014, { overall: OVERALL }),
  ];
  const ticks = (fs: Frame[]) => fs.map((f) => [f.frameId, f.overallFrameId, f.sessionTime]);

  it('packets sharing an overall id with two frame ids become two frames, in arrival order, each with its frame id, session time and receive time', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...oldTick(), ...newTick()]);
    const fs = a.flush();
    expect(ticks(fs)).toEqual([[OLD, OVERALL, 496_561], [NEW, OVERALL, 484_014]]);
    expect(fs.map((f) => f.receivedAtMs)).toEqual([496_561, 484_014]);
    expect(a.metrics.framesClosed).toBe(2);
  });
  it('each packet goes to its own tick: the undone events and the FLBK report to the old one, the slots to the new one', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...oldTick(), ...newTick()]);
    const [undone, fresh] = a.flush();
    expect(undone!.events.map((e) => e.details.code)).toEqual(['PENA', 'OVTK', 'SCAR', 'DRSD', 'FLBK']);
    expect(undone!.flashback).toEqual({ targetFrameId: NEW, targetSessionTime: 481_561 });
    expect([undone!.session, undone!.lapData]).toEqual([undefined, undefined]);
    expect(fresh!.events).toEqual([]);
    expect(fresh!.flashback).toBeUndefined();
    expect([fresh!.session, fresh!.participants, fresh!.lapData]).not.toContain(undefined);
  });
  it('a packet of the older tick that arrives among the newer tick’s packets still joins its own tick', () => {
    const a = new FrameAssembler({ feedId });
    const [first, ...rest] = oldTick();
    pushAll(a, [first!, ...newTick(), ...rest]);
    const fs = a.flush();
    expect(ticks(fs)).toEqual([[OLD, OVERALL, 496_561], [NEW, OVERALL, 484_014]]);
    expect(fs[0]!.events).toHaveLength(5);
    expect(fs[1]!.events).toEqual([]);
  });

  // Inventory 1.10: FLBK sent at 4581.839, f308668, target f307768; RTMT re-sent at f307768 still with 4581.839; Session at 4566.882.
  describe('a re-sent event with the new frame id and the old session time', () => {
    const O = 310_513;
    const undone = () => flbkOf(308_668, O, 4581.839, 307_768, 4566.839);
    const rtmt = () => stub('event', 307_768, 4581.839, { overall: O, code: 'RTMT' });
    const rest = () => [stub('session', 307_768, 4566.882, { overall: O }), ...menuGroup(307_768, 4566.882, { overall: O })];

    it.each([
      ['before the tick’s other packets', () => [undone(), rtmt(), ...rest()]],
      ['after the tick’s other packets', () => [undone(), ...rest(), rtmt()]],
    ])('%s: it stays with the new tick and does not raise its time', (_, packets) => {
      const a = new FrameAssembler({ feedId });
      pushAll(a, packets());
      const fs = a.flush();
      expect(ticks(fs)).toEqual([[308_668, O, 4_581_839], [307_768, O, 4_566_882]]);
      expect(fs[1]!.events.map((e) => e.details.code)).toEqual(['RTMT']);
    });
  });

  it('an ordinary tick stays one frame', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [stub('event', 10, 1.0, { code: 'OVTK' }), stub('session', 10, 1.0), ...menuGroup(10, 1.0), stub('event', 10, 1.0, { code: 'SPTP' })]);
    const fs = a.flush();
    expect(ticks(fs)).toEqual([[10, 10, 1000]]);
    expect(fs[0]!.events.map((e) => e.details.code)).toEqual(['OVTK', 'SPTP']);
  });

  it('attach never lowers a frame’s time', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, menuGroup(4138, 63.318));
    a.attach(stub('event', 0, 63.1, { code: 'SEND' }));
    expect(a.flush()[0]!.sessionTime).toBe(63_318);
  });
  it('attach merges into the tick that arrived last when two ticks share the newest overall id', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...oldTick(), ...newTick()]);
    a.attach(stub('event', 0, 484.014, { code: 'SEND' }));
    const fs = a.flush();
    expect(fs.map((f) => f.events.at(-1)?.details.code)).toEqual(['FLBK', 'SEND']);
  });

  it('both ticks close together once a packet more than the reorder window newer has arrived, oldest arrival first', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...oldTick(), ...newTick()]);
    pushAll(a, menuGroup(NEW + 1, 484.03, { overall: OVERALL + 1 }));
    pushAll(a, menuGroup(NEW + 2, 484.046, { overall: OVERALL + 2 }));
    expect(ticks(push(a, stub('lapData', NEW + 3, 484.062, { overall: OVERALL + 3 })))).toEqual([[OLD, OVERALL, 496_561], [NEW, OVERALL, 484_014]]);
  });
  it('lateness goes by the overall id: a packet more than the window behind is dropped whatever its frame id', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(10, 1.0), stub('motion', 13, 1.048)]);
    expect(push(a, stub('lapData', 999, 1.0, { overall: 10 }))).toEqual([]);
    expect(a.metrics.latePackets).toBe(1);
    expect(ids(a.flush())).toEqual([13]);
  });
  it('a held jump goes by the overall id: its confirmed packets still split into their ticks', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, menuGroup(10, 1.0));
    pushAll(a, [stub('event', 600, 9.6, { overall: 500, code: 'OVTK' }), stub('lapData', 400, 6.4, { overall: 500 })]);
    expect(ticks(a.flush())).toEqual([[10, 10, 1000], [600, 500, 9600], [400, 500, 6400]]);
    expect(a.metrics.latePackets).toBe(0);
  });
});
