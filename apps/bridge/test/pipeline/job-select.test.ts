// `bindJob` with a select (SP4.3b2 Task 1; C49, C51, C55): a per-car job topic narrows the job's result per subscribed
// params, as `bindState` does for a calculator's output. `publishJobResult` wraps `select(value, params)` in the
// result's `computedFor`; `undefined` is no data for those params. Without a select the whole value is published, as
// before (the `forecast-score` feature's test stays unchanged).
//
// The topic is `forecastScore.report`, a real job topic (`Computed<ForecastScoreReport>`), driven with a job whose
// output is keyed by car id, so `selectCar` gives the topic's value type. The hub sends values per subscription params.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { Computed, ServerMessage } from '@pitwall/contracts';
import type { CarId, FeedId, ForecastScoreReport } from '@pitwall/domain';
import type { Job } from '@pitwall/engine';
import { bindJob, defineFeature, selectCar, type TopicBinding } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import type { JobResult } from '../../src/jobs/job-runner.ts';
import { createLogger } from '../../src/log.ts';
import { TopicPublisher } from '../../src/pipeline/topic-publisher.ts';

const F = 'test' as FeedId;
const TOPIC = 'forecastScore.report';
const workerModule = new URL('../features/fixtures/none.ts', import.meta.url);
const job = <Out>(): Job<number, Out> => ({ kind: 'job', id: 'per-car', reads: ['timing'], trigger: 'frame', prepare: () => 1, module: workerModule });

/** A report stand-in per car: the publisher never looks inside it. */
const report = (name: string) => ({ name }) as unknown as ForecastScoreReport;
const PER_CAR = { 0: report('car 0'), 7: report('car 7') } as unknown as Record<CarId, ForecastScoreReport>;
const COMPUTED_FOR = { lap: 12, frameId: 3400 };

/** A hub with one client holding one subscription per `[subscription id, params]`, and the publisher of `binding`. */
function setup(binding: TopicBinding, subscriptions: Array<[string, object]>) {
  let t = 0;
  const hub = new TopicHub({ now: () => (t += 1000) });
  const sent: ServerMessage[] = [];
  hub.addClient('c', { send: (m) => sent.push(m), bufferedAmount: () => 0 });
  for (const [id, params] of subscriptions) hub.subscribe({ clientId: 'c', id, topic: TOPIC, params, feedId: F });
  const log = createLogger({ level: 'debug', destination: new Writable({ write(_c, _e, cb) { cb(); } }) });
  const feature = defineFeature({ name: 'per-car', calculators: [], topics: [binding], jobs: [job<unknown>()] });
  const publisher = new TopicPublisher({ feedId: F, hub, features: [feature], log });
  return { publisher, sent };
}

const ok = (value: unknown): JobResult => ({ jobId: 'per-car', computedFor: COMPUTED_FOR, value });
/** The messages of one subscription since `from`. */
const of = (sent: ServerMessage[], id: string, from = 0) => sent.slice(from).filter((m) => 'id' in m && m.id === id);
/** The last value a subscription was sent (update or snapshot). */
const lastValue = (sent: ServerMessage[], id: string): unknown =>
  of(sent, id).flatMap((m) => (m.type === 'update' || m.type === 'snapshot' ? [m.value] : [])).at(-1);

describe('TopicPublisher: bindJob with a select', () => {
  it('a job topic with selectCar publishes per subscribed carId the entry wrapped in the result\'s computedFor', () => {
    const { publisher, sent } = setup(bindJob(TOPIC, job<Record<CarId, ForecastScoreReport>>(), selectCar), [
      ['a', { carId: 0 }],
      ['b', { carId: 7 }],
    ]);
    expect(publisher.publishJobResult(ok(PER_CAR))).toEqual([]);
    const a: Computed<ForecastScoreReport> = { computedFor: COMPUTED_FOR, value: report('car 0') };
    const b: Computed<ForecastScoreReport> = { computedFor: COMPUTED_FOR, value: report('car 7') };
    expect(lastValue(sent, 'a')).toEqual(a);
    expect(lastValue(sent, 'b')).toEqual(b);
  });

  it('a carId without an entry gets no data, never an error', () => {
    const { publisher, sent } = setup(bindJob(TOPIC, job<Record<CarId, ForecastScoreReport>>(), selectCar), [
      ['absent', { carId: 5 }],
      ['present', { carId: 7 }],
    ]);
    const before = sent.length;
    expect(publisher.publishJobResult(ok(PER_CAR))).toEqual([]);
    const absent = of(sent, 'absent', before);
    expect(absent.some((m) => m.type === 'update' || m.type === 'snapshot')).toBe(false);
    expect(absent).toContainEqual({ type: 'topicStatus', id: 'absent', status: 'noData' });
    expect(absent).not.toContainEqual(expect.objectContaining({ status: 'errored' }));
    expect(lastValue(sent, 'present')).toEqual({ computedFor: COMPUTED_FOR, value: report('car 7') });
  });

  it('a job topic without select publishes the whole value, as today', () => {
    const whole = report('whole');
    const { publisher, sent } = setup(bindJob(TOPIC, job<ForecastScoreReport>()), [
      ['a', {}],
      ['b', { carId: 7 }],
    ]);
    expect(publisher.publishJobResult(ok(whole))).toEqual([]);
    expect(lastValue(sent, 'a')).toEqual({ computedFor: COMPUTED_FOR, value: whole });
    expect(lastValue(sent, 'b')).toEqual({ computedFor: COMPUTED_FOR, value: whole });
  });

  it('an errored job marks every params of its topic errored', () => {
    const { publisher, sent } = setup(bindJob(TOPIC, job<Record<CarId, ForecastScoreReport>>(), selectCar), [
      ['a', { carId: 0 }],
      ['b', { carId: 7 }],
      ['c', { carId: 5 }],
    ]);
    publisher.publishJobResult(ok(PER_CAR));
    const before = sent.length;
    publisher.publishJobResult({ jobId: 'per-car', computedFor: COMPUTED_FOR, error: 'worker failed' });
    for (const id of ['a', 'b', 'c']) expect(of(sent, id, before).at(-1)).toEqual({ type: 'topicStatus', id, status: 'errored' });
  });
});
