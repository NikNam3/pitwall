// Typed topic bindings (groundwork task 3, review F4). Checked twice: `pnpm typecheck` compiles this file, so the
// `@ts-expect-error` lines are the compiler tests (an expectation on a line that compiles is itself an error);
// vitest then runs the same calls and checks the runtime shape of what the helpers return.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FeedStatus, TopicValue } from '@pitwall/contracts';
import type { IncrementalCalculator, QuickCalculator } from '@pitwall/engine';
import { bindHistory, bindInsights, bindState, defineFeature, type TopicBinding } from '../../src/features/feature.ts';
import { selectCar, type ViewCars } from '../../src/features/car-params.ts';

/** A calculator of the given output type; `compute` is never called here. */
const quick = <Out>(id: string, out: Out): QuickCalculator<Out> => ({ id, kind: 'quick', reads: ['timing'], cadence: 'frame', compute: () => out });
const incremental = <Out>(id: string, out: Out): IncrementalCalculator<number, Out> => ({
  id,
  kind: 'incremental',
  reads: ['timing'],
  cadence: 'frame',
  init: () => 0,
  update: (acc) => acc + 1,
  output: () => out,
});

const status: FeedStatus = { feedId: 'f' } as unknown as FeedStatus;
const feedStatusCalc = quick<FeedStatus>('feed.status', status);
const numberCalc = quick<number>('number', 1);
const carsCalc = quick<ViewCars>('cars', [] as unknown as ViewCars);

describe('bindState: the calculator output must fit the topic', () => {
  it('without select: an output that is the topic value compiles, from a quick or an incremental calculator', () => {
    const fromQuick = bindState('feed.status', feedStatusCalc);
    const fromIncremental = bindState('feed.status', incremental<FeedStatus>('feed.status', status));
    expectTypeOf(fromQuick).toEqualTypeOf<TopicBinding>();
    expectTypeOf(fromIncremental).toEqualTypeOf<TopicBinding>();
    expect(fromQuick).toEqual({ topic: 'feed.status', from: 'feed.status' });
    expect(fromIncremental).toEqual({ topic: 'feed.status', from: 'feed.status' });
  });

  it('without select: an output of another type does not compile', () => {
    // @ts-expect-error a number is not a FeedStatus
    const wrongOutput = bindState('feed.status', numberCalc);
    // @ts-expect-error an incremental calculator's output is checked the same way
    const wrongIncremental = bindState('feed.status', incremental<number>('number', 1));
    // @ts-expect-error a FeedStatus is not the value of another topic
    const wrongTopic = bindState('session.info', feedStatusCalc);
    expect([wrongOutput, wrongIncremental, wrongTopic].map((b) => b.topic)).toEqual(['feed.status', 'feed.status', 'session.info']);
  });

  it('with select: the select maps the output to the topic value and keeps params an object', () => {
    const binding = bindState('car.telemetry', carsCalc, (cars, params) => {
      expectTypeOf(cars).toEqualTypeOf<ViewCars>();
      expectTypeOf(params).toEqualTypeOf<object>();
      return undefined;
    });
    expectTypeOf(binding).toEqualTypeOf<TopicBinding>();
    expect(binding).toMatchObject({ topic: 'car.telemetry', from: 'cars', select: expect.any(Function) });
  });

  it('with select: a select returning the wrong type does not compile', () => {
    // @ts-expect-error a string is not CarDynamics
    const wrongReturn = bindState('car.telemetry', carsCalc, () => 'not dynamics');
    // @ts-expect-error CarState is not CarDynamics
    const wrongShape = bindState('car.telemetry', carsCalc, selectCar((car) => car));
    expect(wrongReturn.topic).toBe('car.telemetry');
    expect(wrongShape.topic).toBe('car.telemetry');
  });

  it('with select: a select that does not take the calculator output does not compile', () => {
    // @ts-expect-error the calculator gives a number, the select wants a string
    const wrongInput = bindState('car.telemetry', numberCalc, (text: string) => (text ? undefined : undefined));
    expect(wrongInput.topic).toBe('car.telemetry');
  });

  it('with selectCar: car.detail checks against CarState and car.telemetry against CarDynamics (the picks are cloned, so mutable)', () => {
    const detail = bindState('car.detail', carsCalc, selectCar((car) => car));
    const telemetry = bindState('car.telemetry', carsCalc, selectCar((car) => car.dynamics));
    expect([detail.topic, telemetry.topic]).toEqual(['car.detail', 'car.telemetry']);
  });

  it('a select may return undefined (no data for these params)', () => {
    const none = bindState('car.telemetry', carsCalc, (): TopicValue<'car.telemetry'> | undefined => undefined);
    expect(none.topic).toBe('car.telemetry');
  });
});

describe('bindHistory: the list records must fit the topic', () => {
  it('a list whose records are the topic value compiles', () => {
    const laps = bindHistory('laps', 'laps');
    expectTypeOf(laps).toEqualTypeOf<TopicBinding>();
    expect(laps).toEqual({ topic: 'laps', fromHistory: 'laps' });
    expect(bindHistory('events', 'events')).toEqual({ topic: 'events', fromHistory: 'events' });
  });

  it('a list with other records does not compile', () => {
    // @ts-expect-error stints are not LapRecords
    const wrongList = bindHistory('laps', 'stints');
    // @ts-expect-error a list name that is not in the history
    const unknownList = bindHistory('laps', 'nope');
    expect([wrongList.topic, unknownList.topic]).toEqual(['laps', 'laps']);
  });
});

describe('bindInsights: the insight entries must fit the topic', () => {
  it('the insights topic compiles', () => {
    const binding = bindInsights('insights');
    expectTypeOf(binding).toEqualTypeOf<TopicBinding>();
    expect(binding).toEqual({ topic: 'insights', fromInsights: true });
  });

  it('another topic does not compile', () => {
    // @ts-expect-error InsightEntry is not a LapRecord
    const wrongTopic = bindInsights('laps');
    expect(wrongTopic.topic).toBe('laps');
  });
});

describe('Feature.topics accepts only what the helpers return', () => {
  it('helper results are accepted', () => {
    const feature = defineFeature({
      name: 'typed',
      calculators: [feedStatusCalc],
      topics: [bindState('feed.status', feedStatusCalc), bindHistory('laps', 'laps'), bindInsights('insights')],
    });
    expect(feature.topics.map((t) => t.topic)).toEqual(['feed.status', 'laps', 'insights']);
  });

  it('a hand-written binding object does not compile', () => {
    const handWritten = defineFeature({
      name: 'hand-written',
      calculators: [],
      // @ts-expect-error a binding must come from bindState, bindHistory or bindInsights
      topics: [{ topic: 'feed.status', from: 'feed.status' }],
    });
    const handWrittenHistory = defineFeature({
      name: 'hand-written-history',
      calculators: [],
      // @ts-expect-error the same for the history shape
      topics: [{ topic: 'laps', fromHistory: 'stints' }],
    });
    const handWrittenInsights = defineFeature({
      name: 'hand-written-insights',
      calculators: [],
      // @ts-expect-error and for the insights shape
      topics: [{ topic: 'laps', fromInsights: true }],
    });
    expect([handWritten, handWrittenHistory, handWrittenInsights].map((f) => f.topics.length)).toEqual([1, 1, 1]);
  });
});
