import { beforeEach, describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { ServerMessage } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';

const A = 'feedA' as FeedId, B = 'feedB' as FeedId;
class FakeSink { sent: ServerMessage[] = []; buffered = 0; send(m: ServerMessage) { this.sent.push(m); } bufferedAmount() { return this.buffered; } take() { return this.sent.splice(0); } }
let t: number, hub: TopicHub, sink: FakeSink;
beforeEach(() => { t = 0; hub = new TopicHub({ now: () => t, backpressureBytes: 100 }); sink = new FakeSink(); hub.addClient('c1', sink); });
const sub = (id: string, topic: Parameters<TopicHub['subscribe']>[0]['topic'], params: object = {}, feedId = A) => hub.subscribe({ clientId: 'c1', id, topic, params, feedId });

describe('TopicHub', () => {
  it('state snapshot on subscribe: latest value, else noData', () => {
    sub('s0', 'session.info');
    expect(sink.take()).toEqual([{ type: 'topicStatus', id: 's0', status: 'noData' }]);
    hub.publishState(A, 'session.info', () => ({ v: 1 }));
    expect(sink.take()).toEqual([{ type: 'topicStatus', id: 's0', status: 'ok' }, { type: 'update', id: 's0', value: { v: 1 } }]);
    sub('s1', 'session.info');
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 's1', value: { v: 1 } }]);
  });
  it('append snapshot contains all entries so far, then appends', () => {
    hub.publishAppend(A, 'laps', [{ n: 1 }]); hub.publishAppend(A, 'laps', [{ n: 2 }]);
    sub('l', 'laps');
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 'l', entries: [{ n: 1 }, { n: 2 }] }]);
    hub.publishAppend(A, 'laps', [{ n: 3 }]);
    expect(sink.take()).toEqual([{ type: 'append', id: 'l', entries: [{ n: 3 }] }]);
  });
  it('throttles state updates to maxHz (session.info 2 Hz = 500 ms), latest wins, tick flushes', () => {
    hub.publishState(A, 'session.info', () => 0); sub('s', 'session.info'); sink.take();
    t = 100; hub.publishState(A, 'session.info', () => 1);
    t = 200; hub.publishState(A, 'session.info', () => 2);
    t = 499; hub.tick();
    expect(sink.take()).toEqual([]);
    t = 500; hub.tick();
    expect(sink.take()).toEqual([{ type: 'update', id: 's', value: 2 }]);
    t = 600; hub.publishState(A, 'session.info', () => 3); hub.tick();
    expect(sink.take()).toEqual([]);
    t = 1000; hub.publishState(A, 'session.info', () => 4);
    expect(sink.take()).toEqual([{ type: 'update', id: 's', value: 4 }]);
    t = 2000; hub.tick();
    expect(sink.take()).toEqual([]);
  });
  it('evaluates valueFor per subscription params; undefined → noData', () => {
    sub('d1', 'car.detail', { carId: 1 }); sub('d9', 'car.detail', { carId: 9 }); sink.take();
    hub.publishState(A, 'car.detail', (p) => ((p as { carId: number }).carId < 5 ? { id: (p as { carId: number }).carId } : undefined));
    expect(sink.take()).toEqual([{ type: 'topicStatus', id: 'd1', status: 'ok' }, { type: 'update', id: 'd1', value: { id: 1 } }]);
  });
  it('backpressure: state coalesces to the newest value', () => {
    hub.publishState(A, 'session.info', () => 0); sub('s', 'session.info'); sink.take();
    sink.buffered = 101;
    t = 600; hub.publishState(A, 'session.info', () => 1);
    t = 1200; hub.publishState(A, 'session.info', () => 2); hub.tick();
    expect(sink.take()).toEqual([]);
    sink.buffered = 0; hub.tick();
    expect(sink.take()).toEqual([{ type: 'update', id: 's', value: 2 }]);
  });
  it('backpressure: append overflow becomes a fresh snapshot, never dropped entries', () => {
    hub.publishAppend(A, 'laps', ['a']); sub('l', 'laps'); sink.take();
    sink.buffered = 101;
    hub.publishAppend(A, 'laps', ['b']); hub.publishAppend(A, 'laps', ['c']); hub.tick();
    expect(sink.take()).toEqual([]);
    sink.buffered = 0; hub.tick();
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 'l', entries: ['a', 'b', 'c'] }]);
    hub.publishAppend(A, 'laps', ['d']);
    expect(sink.take()).toEqual([{ type: 'append', id: 'l', entries: ['d'] }]);
  });
  it('forwards status changes once; subscribe sees the current status', () => {
    hub.publishState(A, 'cars.overview', () => []); sub('o', 'cars.overview'); sink.take();
    hub.setStatus(A, 'cars.overview', 'errored'); hub.setStatus(A, 'cars.overview', 'errored');
    expect(sink.take()).toEqual([{ type: 'topicStatus', id: 'o', status: 'errored' }]);
    sub('o2', 'cars.overview');
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 'o2', value: [] }, { type: 'topicStatus', id: 'o2', status: 'errored' }]);
  });
  it('isolates feeds', () => {
    sub('a', 'laps', {}, A); sub('b', 'laps', {}, B); sink.take();
    hub.publishAppend(B, 'laps', ['x']);
    expect(sink.take()).toEqual([{ type: 'append', id: 'b', entries: ['x'] }]);
  });
  it('unsubscribe and removeClient stop delivery', () => {
    sub('l', 'laps'); sub('m', 'events'); sink.take();
    hub.unsubscribe('c1', 'l'); hub.publishAppend(A, 'laps', [1]);
    expect(sink.take()).toEqual([]);
    hub.removeClient('c1'); hub.publishAppend(A, 'events', [1]);
    expect(sink.take()).toEqual([]);
  });
  it('resetFeed and resetAppend send fresh snapshots', () => {
    hub.publishAppend(A, 'laps', [1, 2]); hub.publishState(A, 'session.info', () => 'old');
    sub('l', 'laps'); sub('s', 'session.info'); sink.take();
    hub.resetAppend(A, 'laps', [1]);
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 'l', entries: [1] }]);
    hub.resetFeed(A);
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 'l', entries: [] }, { type: 'topicStatus', id: 's', status: 'noData' }]);
  });
  it('defaults backpressureBytes to 1_000_000', () => {
    const h = new TopicHub({ now: () => 0 }); const s = new FakeSink(); h.addClient('x', s);
    h.subscribe({ clientId: 'x', id: 'l', topic: 'laps', params: {}, feedId: A }); s.take();
    s.buffered = 1_000_000; h.publishAppend(A, 'laps', [1]);
    expect(s.take()).toEqual([{ type: 'append', id: 'l', entries: [1] }]);
    s.buffered = 1_000_001; h.publishAppend(A, 'laps', [2]);
    expect(s.take()).toEqual([]);
  });
});
