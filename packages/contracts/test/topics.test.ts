import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CarDynamics, CarId, CarMotion, CarState, FeedId, Known, LapRecord } from '@pitwall/domain';
import type { CarTelemetry } from '../src/topics/car.telemetry.ts';
import {
  CONTRACT_VERSION,
  TOPICS,
  type CarOverview,
  type FeedInfo,
  type FeedStatus,
  type InsightEntry,
  type ReservedCommand,
  type SessionInfo,
  type TopicName,
  type TopicParams,
  type TopicValue,
} from '../src/index.ts';
import { defineTopic } from '../src/topic-def.ts';
import carDetail from '../src/topics/car.detail.ts';
import laps from '../src/topics/laps.ts';

describe('TOPICS', () => {
  it('has exactly the 11 topics of spec 8.4 with their modes and rates', () => {
    const table = Object.entries(TOPICS)
      .map(([key, d]) => [key, d.name, d.mode, d.maxHz] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    expect(table).toEqual([
      ['car.detail', 'car.detail', 'state', 30],
      ['car.telemetry', 'car.telemetry', 'state', 60],
      ['cars.overview', 'cars.overview', 'state', 10],
      ['events', 'events', 'append', Infinity],
      ['feed.status', 'feed.status', 'state', 2],
      ['flagPhases', 'flagPhases', 'append', Infinity],
      ['insights', 'insights', 'append', Infinity],
      ['laps', 'laps', 'append', Infinity],
      ['pitStops', 'pitStops', 'append', Infinity],
      ['session.info', 'session.info', 'state', 2],
      ['stints', 'stints', 'append', Infinity],
    ]);
  });
  it('exports the contract version', () => { expect(CONTRACT_VERSION).toBe(2); });
});

describe('defineTopic', () => {
  it('returns mode and rate without a name', () => {
    expect(defineTopic<Record<string, never>, number>({ mode: 'state', maxHz: 5 })).toEqual({ mode: 'state', maxHz: 5 });
  });
  it('is what each topic file default-exports', () => {
    expect(carDetail).toEqual({ mode: 'state', maxHz: 30 });
    expect(laps).toEqual({ mode: 'append', maxHz: Infinity });
  });
});

describe('topic types', () => {
  it('keep TopicName, TopicParams and TopicValue', () => {
    expectTypeOf<TopicName>().toEqualTypeOf<
      | 'feed.status' | 'session.info' | 'cars.overview' | 'car.detail' | 'car.telemetry' | 'laps'
      | 'stints' | 'pitStops' | 'flagPhases' | 'events' | 'insights'
    >();
    expectTypeOf<TopicParams<'car.detail'>>().toEqualTypeOf<{ carId: CarId }>();
    expectTypeOf<TopicParams<'car.detail'>['carId']>().toEqualTypeOf<CarId>();
    expectTypeOf<TopicParams<'car.telemetry'>['carId']>().toEqualTypeOf<CarId>();
    expectTypeOf<TopicParams<'laps'>>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<TopicValue<'car.detail'>>().toEqualTypeOf<CarState>();
    expectTypeOf<TopicValue<'car.telemetry'>>().toEqualTypeOf<{ motion: CarMotion; dynamics: Known<CarDynamics> }>();
    expectTypeOf<TopicValue<'car.telemetry'>>().toEqualTypeOf<CarTelemetry>();
    expectTypeOf<TopicValue<'laps'>>().toEqualTypeOf<LapRecord>();
    expectTypeOf<TopicValue<'feed.status'>>().toEqualTypeOf<FeedStatus>();
    expectTypeOf<TopicValue<'session.info'>>().toEqualTypeOf<SessionInfo>();
    expectTypeOf<TopicValue<'cars.overview'>>().toEqualTypeOf<CarOverview[]>();
    expectTypeOf<TopicValue<'insights'>>().toEqualTypeOf<InsightEntry>();
  });
  it('carry what the UI needs to grey out stale values', () => {
    expectTypeOf<CarOverview['updatedAt']>().toEqualTypeOf<CarState['updatedAt']>();
    expectTypeOf<FeedStatus['cadenceMs']>().toEqualTypeOf<number | undefined>();
  });
  it('keep the moved DTO types importable from the package index', () => {
    expectTypeOf<FeedInfo['feedId']>().toEqualTypeOf<FeedId>();
    expectTypeOf<ReservedCommand['kind']>().toEqualTypeOf<'boxCall'>();
  });
});
