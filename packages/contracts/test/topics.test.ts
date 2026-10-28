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
  type ReplayStatus,
  type ReservedCommand,
  type SessionInfo,
  type TopicName,
  type TopicParams,
  type TopicValue,
} from '../src/index.ts';
import { defineTopic, type TopicOwner } from '../src/topic-def.ts';
import carDetail from '../src/topics/car.detail.ts';
import laps from '../src/topics/laps.ts';

describe('TOPICS', () => {
  it('has exactly the 12 feed topics (spec 8.4 and replay.status of 8.5) with their modes and rates', () => {
    const table = Object.entries(TOPICS)
      .filter(([, d]) => d.scope === 'feed' && d.owner === 'core')
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
      ['replay.status', 'replay.status', 'state', 4],
      ['session.info', 'session.info', 'state', 2],
      ['stints', 'stints', 'append', Infinity],
    ]);
  });
  it('gives every one of the 12 feed topics owner core and scope feed', () => {
    const feed = Object.values(TOPICS).filter((d) => d.scope === 'feed');
    expect(feed).toHaveLength(12);
    for (const d of feed) expect(d).toMatchObject({ owner: 'core', scope: 'feed' });
  });
  it('has the global topic dev.calcStats: owner core, state, 1 Hz', () => {
    expect(TOPICS['dev.calcStats']).toMatchObject({ name: 'dev.calcStats', owner: 'core', scope: 'global', mode: 'state', maxHz: 1 });
  });
  it.each(['ui.workbooks', 'ui.linkGroups', 'ui.alerts', 'ui.settings'] as const)('has the global topic %s: owner core, state', (name) => {
    expect(TOPICS[name]).toMatchObject({ name, owner: 'core', scope: 'global', mode: 'state' });
  });
  it('exports the contract version', () => { expect(CONTRACT_VERSION).toBe(4); });
});

describe('defineTopic', () => {
  it('returns owner, mode and rate without a name, scope defaulting to feed', () => {
    expect(defineTopic<Record<string, never>, number>({ owner: 'core', mode: 'state', maxHz: 5 })).toEqual({ owner: 'core', mode: 'state', maxHz: 5, scope: 'feed' });
  });
  it('keeps an explicit global scope and a non-core owner', () => {
    expect(defineTopic<Record<string, never>, number>({ owner: 'ui', mode: 'state', maxHz: 5, scope: 'global' })).toEqual({ owner: 'ui', mode: 'state', maxHz: 5, scope: 'global' });
    expectTypeOf<TopicOwner>().toEqualTypeOf<'core' | (string & {})>();
  });
  it('does not compile without an owner', () => {
    // @ts-expect-error owner is required
    const noOwner = defineTopic<Record<string, never>, number>({ mode: 'state', maxHz: 5 });
    expect(noOwner.mode).toBe('state');
  });
  it('is what each topic file default-exports', () => {
    expect(carDetail).toEqual({ owner: 'core', mode: 'state', maxHz: 30, scope: 'feed' });
    expect(laps).toEqual({ owner: 'core', mode: 'append', maxHz: Infinity, scope: 'feed' });
  });
});

describe('topic types', () => {
  it('keep TopicName, TopicParams and TopicValue', () => {
    expectTypeOf<TopicName>().toEqualTypeOf<
      | 'feed.status' | 'session.info' | 'cars.overview' | 'car.detail' | 'car.telemetry' | 'laps'
      | 'stints' | 'pitStops' | 'flagPhases' | 'events' | 'insights' | 'dev.calcStats'
      | 'replay.status' | 'ui.workbooks' | 'ui.linkGroups' | 'ui.alerts' | 'ui.settings'
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
    expectTypeOf<TopicValue<'replay.status'>>().toEqualTypeOf<ReplayStatus>();
    expectTypeOf<TopicParams<'replay.status'>>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<ReplayStatus>().toEqualTypeOf<{ paused: boolean; speed: number; sessionTimeMs: number; playerLap: number; atEnd: boolean; note?: 'beyondEnd' }>();
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
