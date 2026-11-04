// Typed topic bindings (groundwork task 3, review F4). Checked twice: `pnpm typecheck` compiles this file, so the
// `@ts-expect-error` lines are the compiler tests (an expectation on a line that compiles is itself an error);
// vitest then runs the same calls and checks the runtime shape of what the helpers return.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FeedStatus, TopicValue } from '@pitwall/contracts';
import type { EngineView, IncrementalCalculator, QuickCalculator } from '@pitwall/engine';
import { bindHistory, bindInsights, bindLive, bindState, defineFeature, type TopicBinding } from '../../src/features/feature.ts';
import { selectCarSlot } from '../../src/features/car-params.ts';

/** Every car slot as the engine holds it, read-only. */
type ViewCars = EngineView['live']['cars'];

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
    // @ts-expect-error a string is not CarTelemetry
    const wrongReturn = bindState('car.telemetry', carsCalc, () => 'not dynamics');
    // @ts-expect-error a value without dynamics is not CarTelemetry
    const wrongShape = bindState('car.telemetry', carsCalc, (cars) => (cars[0] === undefined ? undefined : { motion: { ...cars[0].motion } }));
    expect(wrongReturn.topic).toBe('car.telemetry');
    expect(wrongShape.topic).toBe('car.telemetry');
  });

  it('with select: a select that does not take the calculator output does not compile', () => {
    // @ts-expect-error the calculator gives a number, the select wants a string
    const wrongInput = bindState('car.telemetry', numberCalc, (text: string) => (text ? undefined : undefined));
    expect(wrongInput.topic).toBe('car.telemetry');
  });

  it('a select may return undefined (no data for these params)', () => {
    const none = bindState('car.telemetry', carsCalc, (): TopicValue<'car.telemetry'> | undefined => undefined);
    expect(none.topic).toBe('car.telemetry');
  });
});

// C55: `bindLive` publishes a part of the live state (C39's `live`), with no calculator between.
describe('bindLive: the selected part of the live state must fit the topic', () => {
  it('the select gets the read-only live state and the params, and the binding keeps it as `fromLive`', () => {
    const select = (live: Parameters<Parameters<typeof bindLive>[1]>[0], params: object) => {
      expectTypeOf(live.cars).toEqualTypeOf<ViewCars>();
      expectTypeOf(params).toEqualTypeOf<object>();
      return undefined;
    };
    const binding = bindLive('car.telemetry', select);
    expectTypeOf(binding).toEqualTypeOf<TopicBinding>();
    expect(binding).toEqual({ topic: 'car.telemetry', fromLive: select });
  });

  it('the live state holds the values only, read-only: no history, no weekend, no writes', () => {
    const binding = bindLive('car.telemetry', (live) => {
      // @ts-expect-error the projection is no part of the live state (C39: `history` is the view's own)
      void live.history;
      // @ts-expect-error nor the weekend's earlier sessions (C39: `weekend`)
      void live.weekend;
      // @ts-expect-error nor the signals (C13)
      void live.signals;
      // @ts-expect-error the live state is read-only
      live.playerCar = 0 as never;
      return undefined;
    });
    expect(binding.topic).toBe('car.telemetry');
  });

  it('with selectCarSlot: car.detail checks against CarState and car.telemetry against CarTelemetry (the picks are copied, so mutable)', () => {
    const detail = bindLive('car.detail', selectCarSlot((car) => car));
    const telemetry = bindLive('car.telemetry', selectCarSlot((car) => ({ motion: car.motion, dynamics: car.dynamics })));
    expect([detail, telemetry]).toEqual([
      { topic: 'car.detail', fromLive: expect.any(Function) },
      { topic: 'car.telemetry', fromLive: expect.any(Function) },
    ]);
  });

  it('a select returning the wrong type does not compile', () => {
    // @ts-expect-error a string is not CarTelemetry
    const wrongReturn = bindLive('car.telemetry', () => 'not telemetry');
    // @ts-expect-error a value without dynamics is not CarTelemetry
    const wrongShape = bindLive('car.telemetry', selectCarSlot((car) => ({ motion: car.motion })));
    // @ts-expect-error CarTelemetry is not the CarState of car.detail
    const wrongTopic = bindLive('car.detail', selectCarSlot((car) => ({ motion: car.motion, dynamics: car.dynamics })));
    expect([wrongReturn.topic, wrongShape.topic, wrongTopic.topic]).toEqual(['car.telemetry', 'car.telemetry', 'car.detail']);
  });

  it('a select may return undefined (no data for these params)', () => {
    const none = bindLive('car.detail', (): TopicValue<'car.detail'> | undefined => undefined);
    expect(none.topic).toBe('car.detail');
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
      topics: [bindState('feed.status', feedStatusCalc), bindHistory('laps', 'laps'), bindInsights('insights'), bindLive('car.detail', selectCarSlot((car) => car))],
    });
    expect(feature.topics.map((t) => t.topic)).toEqual(['feed.status', 'laps', 'insights', 'car.detail']);
  });

  it('a hand-written binding object does not compile', () => {
    const handWritten = defineFeature({
      name: 'hand-written',
      calculators: [],
      // @ts-expect-error a binding must come from bindState, bindHistory, bindInsights or bindLive
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
    const handWrittenLive = defineFeature({
      name: 'hand-written-live',
      calculators: [],
      // @ts-expect-error and for the live shape
      topics: [{ topic: 'car.detail', fromLive: () => undefined }],
    });
    expect([handWritten, handWrittenHistory, handWrittenInsights, handWrittenLive].map((f) => f.topics.length)).toEqual([1, 1, 1, 1]);
  });
});
