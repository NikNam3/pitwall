// GalleryConnection (spec 9.2, Task 21). Contract assumed, in `apps/ui/src/gallery/gallery-connection.ts`:
//  - `new GalleryConnection(moment: MomentValues, overrides?: GalleryOverride[])` where
//    `GalleryOverride = { topic: TopicName; value: unknown }`; the type `MomentValues` is imported from
//    `apps/ui/src/gallery/moment-values.ts` (a UI-side copy of the bridge's type, as the UI cannot import the bridge);
//  - it is a `Connection` that is `open` from the start; `send({type:'subscribe', id, topic, params})` answers with a
//    `snapshot` carrying the id and the `value` (or `entries`) of the moment entry with that topic and equal params
//    (delivered at the latest on the next microtask), or `{type:'topicStatus', id, status:'noData'}` when the moment
//    has none; an override replaces the value of every entry of its topic (even one the moment lacks), and an
//    override whose `value` is `undefined` makes the topic `noData`;
//  - `unsubscribe`, `heartbeat` and other messages are ignored; it never pushes anything unasked.
import type { ServerMessage } from '@pitwall/contracts';
import { describe, expect, it } from 'vitest';
import { GalleryConnection } from '../../src/gallery/gallery-connection.ts';
import type { MomentValues } from '../../src/gallery/moment-values.ts';

const moment: MomentValues = [
  { topic: 'feed.status', params: {}, value: { feedId: 'f', connected: true, stale: false } },
  { topic: 'car.detail', params: { carId: 3 }, value: { marker: 'three' } },
  { topic: 'laps', params: {}, entries: [{ lapNumber: 1 }] },
];

const ask = async (connection: GalleryConnection, topic: string, params: object = {}, id = 's1'): Promise<ServerMessage[]> => {
  const got: ServerMessage[] = [];
  const off = connection.onMessage((m) => got.push(m));
  connection.send({ type: 'subscribe', id, topic: topic as never, params });
  await Promise.resolve();
  await Promise.resolve();
  off();
  return got;
};

describe('GalleryConnection', () => {
  it('is open from the start', () => {
    expect(new GalleryConnection(moment).state).toBe('open');
  });

  it('answers a subscription to a topic in the moment with a snapshot of its value', async () => {
    expect(await ask(new GalleryConnection(moment), 'feed.status')).toEqual([
      { type: 'snapshot', id: 's1', value: { feedId: 'f', connected: true, stale: false } },
    ]);
  });

  it('matches per-car topics by params', async () => {
    const c = new GalleryConnection(moment);
    expect(await ask(c, 'car.detail', { carId: 3 })).toEqual([{ type: 'snapshot', id: 's1', value: { marker: 'three' } }]);
    expect(await ask(c, 'car.detail', { carId: 4 }, 's2')).toEqual([{ type: 'topicStatus', id: 's2', status: 'noData' }]);
  });

  it('answers an append topic with its entries', async () => {
    expect(await ask(new GalleryConnection(moment), 'laps')).toEqual([{ type: 'snapshot', id: 's1', entries: [{ lapNumber: 1 }] }]);
  });

  it('answers a topic missing from the moment with topicStatus noData', async () => {
    expect(await ask(new GalleryConnection(moment), 'session.info', {}, 'x')).toEqual([{ type: 'topicStatus', id: 'x', status: 'noData' }]);
  });

  it('lets a case override a moment value', async () => {
    const c = new GalleryConnection(moment, [{ topic: 'feed.status', value: { feedId: 'f', connected: false, stale: true } }]);
    expect(await ask(c, 'feed.status')).toEqual([{ type: 'snapshot', id: 's1', value: { feedId: 'f', connected: false, stale: true } }]);
  });

  it('lets a case supply a topic the moment lacks, and undefined hides one the moment has', async () => {
    const c = new GalleryConnection(moment, [
      { topic: 'session.info', value: { marker: 'case' } },
      { topic: 'feed.status', value: undefined },
    ]);
    expect(await ask(c, 'session.info', {}, 'a')).toEqual([{ type: 'snapshot', id: 'a', value: { marker: 'case' } }]);
    expect(await ask(c, 'feed.status', {}, 'b')).toEqual([{ type: 'topicStatus', id: 'b', status: 'noData' }]);
  });

  it('pushes nothing unasked and ignores unsubscribe and heartbeat', async () => {
    const c = new GalleryConnection(moment);
    const got: ServerMessage[] = [];
    c.onMessage((m) => got.push(m));
    c.send({ type: 'heartbeat' });
    c.send({ type: 'unsubscribe', id: 'nothing' });
    await Promise.resolve();
    expect(got).toEqual([]);
  });
});
