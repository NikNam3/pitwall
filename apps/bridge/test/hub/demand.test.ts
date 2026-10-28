// What the hub tells the pipeline about demand: the topics that have a subscriber, per feed (spec 7.3, review F1).
import { beforeEach, describe, expect, it } from 'vitest';
import type { TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { TopicHub } from '../../src/hub/topic-hub.ts';

const A = 'feedA' as FeedId, B = 'feedB' as FeedId;
const sink = () => ({ send: () => {}, bufferedAmount: () => 0 });

let changed: FeedId[];
let seen: Array<ReadonlySet<TopicName>>;
let hub: TopicHub;
beforeEach(() => {
  changed = [];
  seen = [];
  // The set as the callback sees it: the hub has already applied the change.
  hub = new TopicHub({ now: () => 0, onDemandChange: (feedId) => { changed.push(feedId); seen.push(new Set(hub.subscribedTopics(feedId))); } });
  hub.addClient('c1', sink());
  hub.addClient('c2', sink());
});
const sub = (clientId: string, id: string, topic: TopicName, feedId = A, params: object = {}) =>
  hub.subscribe({ clientId, id, topic, params, feedId });
const topics = (feedId: FeedId) => [...hub.subscribedTopics(feedId)].sort();

describe('TopicHub.subscribedTopics', () => {
  it('is empty for a feed nobody subscribed to, and for an unknown feed', () => {
    expect(topics(A)).toEqual([]);
    expect(topics('nobody' as FeedId)).toEqual([]);
  });

  it('holds each topic once, however many subscriptions and clients it has', () => {
    sub('c1', 'a', 'cars.overview'); sub('c1', 'b', 'cars.overview'); sub('c2', 'c', 'cars.overview'); sub('c2', 'd', 'laps');
    expect(topics(A)).toEqual(['cars.overview', 'laps']);
  });

  it('keeps the feeds apart', () => {
    sub('c1', 'a', 'cars.overview', A); sub('c2', 'b', 'laps', B);
    expect(topics(A)).toEqual(['cars.overview']);
    expect(topics(B)).toEqual(['laps']);
  });

  it('ignores a subscription of an unknown client', () => {
    sub('ghost', 'a', 'cars.overview');
    expect(topics(A)).toEqual([]);
    expect(changed).toEqual([]);
  });

  it('does not count subscriptions to different params of one topic twice', () => {
    sub('c1', 'a', 'car.telemetry', A, { carId: 1 }); sub('c1', 'b', 'car.telemetry', A, { carId: 2 });
    expect(topics(A)).toEqual(['car.telemetry']);
  });
});

describe('TopicHub onDemandChange', () => {
  it('fires after subscribe when a topic gets its first subscription, with the feed and the new set', () => {
    sub('c1', 'a', 'cars.overview');
    expect(changed).toEqual([A]);
    expect(seen).toEqual([new Set(['cars.overview'])]);
  });

  it('does not fire for a second subscription to a topic that already has one, from the same or another client', () => {
    sub('c1', 'a', 'cars.overview');
    sub('c1', 'b', 'cars.overview');
    sub('c2', 'c', 'cars.overview');
    expect(changed).toEqual([A]);
  });

  it('fires once more for each further new topic', () => {
    sub('c1', 'a', 'cars.overview'); sub('c1', 'b', 'laps');
    expect(changed).toEqual([A, A]);
    expect(seen.at(-1)).toEqual(new Set(['cars.overview', 'laps']));
  });

  it('does not fire when a subscription is replaced by one for the same topic', () => {
    sub('c1', 'a', 'car.telemetry', A, { carId: 1 });
    sub('c1', 'a', 'car.telemetry', A, { carId: 2 });
    expect(changed).toEqual([A]);
  });

  it('fires once when a replacement moves a subscription to another topic', () => {
    sub('c1', 'a', 'cars.overview');
    changed.length = 0; seen.length = 0;
    sub('c1', 'a', 'laps');
    expect(changed).toEqual([A]);
    expect(seen).toEqual([new Set(['laps'])]);
  });

  it('keeps a topic while another subscription holds it: unsubscribing one of two does not fire', () => {
    sub('c1', 'a', 'cars.overview'); sub('c2', 'b', 'cars.overview');
    changed.length = 0;
    hub.unsubscribe('c1', 'a');
    expect(changed).toEqual([]);
    expect(topics(A)).toEqual(['cars.overview']);
  });

  it('keeps a topic while the same client holds it with another subscription id', () => {
    sub('c1', 'a', 'cars.overview'); sub('c1', 'b', 'cars.overview');
    changed.length = 0;
    hub.unsubscribe('c1', 'a');
    expect(changed).toEqual([]);
    expect(topics(A)).toEqual(['cars.overview']);
  });

  it('fires after the last unsubscribe of a topic, and the callback sees the topic gone', () => {
    sub('c1', 'a', 'cars.overview'); sub('c2', 'b', 'cars.overview'); sub('c2', 'c', 'laps');
    changed.length = 0; seen.length = 0;
    hub.unsubscribe('c1', 'a');
    hub.unsubscribe('c2', 'b');
    expect(changed).toEqual([A]);
    expect(seen).toEqual([new Set(['laps'])]);
  });

  it('does not fire for an unsubscribe that matches nothing', () => {
    sub('c1', 'a', 'cars.overview');
    changed.length = 0;
    hub.unsubscribe('c1', 'nope');
    hub.unsubscribe('ghost', 'a');
    expect(changed).toEqual([]);
  });

  it('fires when removeClient takes the last subscription of a topic', () => {
    sub('c1', 'a', 'cars.overview'); sub('c1', 'b', 'laps');
    changed.length = 0; seen.length = 0;
    hub.removeClient('c1');
    expect(changed).toEqual([A]);
    expect(seen).toEqual([new Set()]);
    expect(topics(A)).toEqual([]);
  });

  it('does not fire when removeClient leaves every topic with a subscriber', () => {
    sub('c1', 'a', 'cars.overview'); sub('c2', 'b', 'cars.overview');
    changed.length = 0;
    hub.removeClient('c1');
    expect(changed).toEqual([]);
    expect(topics(A)).toEqual(['cars.overview']);
  });

  it('fires when removeClient takes only some of the topics', () => {
    sub('c1', 'a', 'cars.overview'); sub('c1', 'b', 'laps'); sub('c2', 'c', 'laps');
    changed.length = 0; seen.length = 0;
    hub.removeClient('c1');
    expect(changed).toEqual([A]);
    expect(seen).toEqual([new Set(['laps'])]);
  });

  it('fires once per feed whose set changed when removeClient takes subscriptions of several feeds', () => {
    sub('c1', 'a', 'cars.overview', A); sub('c1', 'b', 'laps', A); sub('c1', 'c', 'laps', B); sub('c1', 'd', 'cars.overview', B);
    changed.length = 0;
    hub.removeClient('c1');
    expect([...changed].sort()).toEqual([A, B]);
  });

  it('does not fire for a feed whose topics another client still holds', () => {
    sub('c1', 'a', 'cars.overview', A); sub('c1', 'b', 'laps', B); sub('c2', 'c', 'laps', B);
    changed.length = 0;
    hub.removeClient('c1');
    expect(changed).toEqual([A]);
    expect(topics(B)).toEqual(['laps']);
  });

  it('does not fire for removeClient of an unknown client or of one without subscriptions', () => {
    hub.removeClient('ghost');
    hub.removeClient('c1');
    expect(changed).toEqual([]);
  });

  it('reports each feed on its own', () => {
    sub('c1', 'a', 'cars.overview', A); sub('c1', 'b', 'cars.overview', B);
    expect(changed).toEqual([A, B]);
    hub.unsubscribe('c1', 'a');
    expect(changed).toEqual([A, B, A]);
    expect(topics(A)).toEqual([]);
    expect(topics(B)).toEqual(['cars.overview']);
  });

  it('is optional', () => {
    const quiet = new TopicHub({ now: () => 0 });
    quiet.addClient('c', sink());
    expect(() => {
      quiet.subscribe({ clientId: 'c', id: 'a', topic: 'laps', params: {}, feedId: A });
      quiet.unsubscribe('c', 'a');
      quiet.removeClient('c');
    }).not.toThrow();
    expect([...quiet.subscribedTopics(A)]).toEqual([]);
  });
});
