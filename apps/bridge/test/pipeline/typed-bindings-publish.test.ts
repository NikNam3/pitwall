// The bindings the typed helpers return are handled by TopicPublisher exactly as the hand-written ones were.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { FeedStatus, InsightEntry, ServerMessage } from '@pitwall/contracts';
import type { FeedId, SessionTime } from '@pitwall/domain';
import type { DeepReadonly, History, HistoryDelta, QuickCalculator, SchedulerResult } from '@pitwall/engine';
import { bindHistory, bindInsights, bindState, defineFeature } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { TopicPublisher } from '../../src/pipeline/topic-publisher.ts';

const F = 'test' as FeedId;
const quick = <Out>(id: string): QuickCalculator<Out> => ({ id, kind: 'quick', reads: ['timing'], cadence: 'frame', compute: () => undefined as Out });

function setup(features: Parameters<typeof defineFeature>[0][], subscriptions: Array<[string, object]>) {
  let t = 0;
  const hub = new TopicHub({ now: () => (t += 1000) });
  const sent: ServerMessage[] = [];
  const logs: Array<Record<string, unknown>> = [];
  hub.addClient('c', { send: (m) => sent.push(m), bufferedAmount: () => 0 });
  for (const [topic, params] of subscriptions) hub.subscribe({ clientId: 'c', id: topic, topic: topic as never, params, feedId: F });
  const log = createLogger({ level: 'debug', destination: new Writable({ write(c, _e, cb) { logs.push(JSON.parse(String(c))); cb(); } }) });
  const publisher = new TopicPublisher({ feedId: F, hub, features: features.map(defineFeature), log });
  return { publisher, sent, logs };
}

const result = (over: Partial<SchedulerResult>): SchedulerResult => ({ ran: [], outputs: new Map(), errors: [], insights: [], ...over });
const lengths = (over: Partial<Record<keyof History, number>>) => ({ laps: 0, stints: 0, pitStops: 0, flagPhases: 0, events: 0, miniSectors: 0, ...over });
const delta = (before: number, after: number, truncated = false): HistoryDelta => ({ before: lengths({ laps: before }), after: lengths({ laps: after }), truncated });
const historyOf = (laps: unknown[]) => ({ ...lengths({}), laps, stints: [], pitStops: [], flagPhases: [], events: [], miniSectors: [] }) as unknown as DeepReadonly<History>;
const messages = (sent: ServerMessage[], id: string) => sent.filter((m) => 'id' in m && m.id === id);

describe('TopicPublisher with bindState', () => {
  it('publishes the output of a calculator that ran, as is, when there is no select', () => {
    const { publisher, sent } = setup([{ name: 'a', calculators: [quick<FeedStatus>('feed.status')], topics: [bindState('feed.status', quick<FeedStatus>('feed.status'))] }], [['feed.status', {}]]);
    const out = { feedId: F };
    expect(publisher.publishOutputs(result({ ran: ['feed.status'], outputs: new Map([['feed.status', out]]) }))).toEqual([]);
    expect(messages(sent, 'feed.status')).toContainEqual({ type: 'update', id: 'feed.status', value: out });
  });

  it('runs the select with the subscription params and publishes what it returns', () => {
    const calls: object[] = [];
    const binding = bindState('car.telemetry', quick<number>('cars'), (n, params) => {
      calls.push(params);
      return { speedKmh: n } as never;
    });
    const { publisher, sent } = setup([{ name: 'b', calculators: [quick('cars')], topics: [binding] }], [['car.telemetry', { carId: 3 }]]);
    publisher.publishOutputs(result({ ran: ['cars'], outputs: new Map([['cars', 7]]) }));
    expect(calls).toEqual([{ carId: 3 }]);
    expect(messages(sent, 'car.telemetry')).toContainEqual({ type: 'update', id: 'car.telemetry', value: { speedKmh: 7 } });
  });

  it('marks the topic errored while its calculator failed, and contains a throwing select', () => {
    const boom = bindState('car.telemetry', quick<number>('cars'), () => {
      throw new Error('select failed');
    });
    const { publisher, sent } = setup([{ name: 'c', calculators: [quick('cars')], topics: [boom] }], [['car.telemetry', { carId: 0 }]]);
    const caught = publisher.publishOutputs(result({ ran: ['cars'], outputs: new Map([['cars', 1]]) }));
    expect(caught).toMatchObject([{ topic: 'car.telemetry' }]);
    expect(messages(sent, 'car.telemetry').at(-1)).toEqual({ type: 'topicStatus', id: 'car.telemetry', status: 'errored' });
    publisher.publishOutputs(result({ errors: [{ id: 'cars', error: new Error('calc failed') }] }));
    expect(messages(sent, 'car.telemetry').at(-1)).toEqual({ type: 'topicStatus', id: 'car.telemetry', status: 'errored' });
  });
});

describe('TopicPublisher with bindHistory', () => {
  it('appends what the list gained, and sends the whole list after a flashback', () => {
    const { publisher, sent } = setup([{ name: 'h', calculators: [], topics: [bindHistory('laps', 'laps')] }], [['laps', {}]]);
    publisher.publishHistory(historyOf(['l1', 'l2', 'l3']), delta(1, 3));
    expect(messages(sent, 'laps')).toContainEqual({ type: 'append', id: 'laps', entries: ['l2', 'l3'] });
    publisher.publishHistory(historyOf(['l1']), delta(3, 1, true));
    expect(messages(sent, 'laps').at(-1)).toMatchObject({ id: 'laps', entries: ['l1'] });
  });

  it('sends nothing when the list did not grow', () => {
    const { publisher, sent } = setup([{ name: 'h', calculators: [], topics: [bindHistory('laps', 'laps')] }], [['laps', {}]]);
    const before = sent.length;
    publisher.publishHistory(historyOf(['l1']), delta(1, 1));
    expect(sent.slice(before).filter((m) => m.type === 'append')).toEqual([]);
  });
});

describe('TopicPublisher with bindInsights', () => {
  it('appends the insight changes', () => {
    const { publisher, sent } = setup([{ name: 'i', calculators: [], topics: [bindInsights('insights')] }], [['insights', {}]]);
    const changes: InsightEntry[] = [{ type: 'resolved', key: 'k', at: 5 as SessionTime }];
    expect(publisher.publishInsights(changes)).toEqual([]);
    expect(messages(sent, 'insights')).toContainEqual({ type: 'append', id: 'insights', entries: changes });
  });
});
