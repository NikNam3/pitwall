// apps/bridge/test/features/state-features.test.ts
import { describe, expect, it } from 'vitest';
import type { QuickCalculator } from '@pitwall/engine';
import type { Feature, TopicBinding } from '../../src/features/feature.ts';
import sessionInfo from '../../src/features/session-info/register.ts';
import carsOverview from '../../src/features/cars-overview/register.ts';
import carDetail from '../../src/features/car-detail/register.ts';
import carTelemetry from '../../src/features/car-telemetry/register.ts';
import feedStatus from '../../src/features/feed-status/register.ts';
import history from '../../src/features/history/register.ts';
import insights from '../../src/features/insights/register.ts';
import { ScenarioBuilder } from '../../../../packages/engine/test/builders/index.ts';
import { viewFrom } from '../helpers/view.ts';

const view = viewFrom(new ScenarioBuilder({ sessionUid: 1896528710553860228n, cars: 3, player: 2 }).session().participants().frames(3, () => {}).build());
const out = (f: Feature, id: string) => (f.calculators.find((c) => c.id === id) as QuickCalculator<unknown>).compute(view);
const select = (f: Feature, topic: string, params: object) => {
  const b = f.topics.find((t) => t.topic === topic) as Extract<TopicBinding, { from: string }>;
  return b.select ? b.select(out(f, b.from), params) : out(f, b.from);
};

describe('base state features', () => {
  it('session.info carries the decimal sessionUid and is JSON-safe', () => {
    const info = out(sessionInfo, 'session.info') as Record<string, unknown>;
    expect(info).toMatchObject({ feedId: view.state.feedId, sessionUid: '1896528710553860228', playerCar: 2 });
    expect(info['session']).toEqual(view.state.session);
    expect(JSON.parse(JSON.stringify(info))).toEqual(info);
  });
  it('cars.overview: one entry per car, picked fields, cloned', () => {
    const list = out(carsOverview, 'cars.overview') as Array<Record<string, unknown>>;
    expect(list).toHaveLength(view.state.cars.length);
    const car = view.state.cars[1]!;
    expect(list[1]).toEqual({ id: car.id, identity: car.identity, timing: car.timing,
      tyres: { actualCompound: car.tyres.actualCompound, visualCompound: car.tyres.visualCompound, age: car.tyres.age } });
    expect(list[1]!['timing']).not.toBe(car.timing);
  });
  it('car.detail selects one car by carId', () => {
    expect(select(carDetail, 'car.detail', { carId: 1 })).toEqual(view.state.cars[1]);
    expect(select(carDetail, 'car.detail', { carId: 1 })).not.toBe(view.state.cars[1]);
    expect(select(carDetail, 'car.detail', { carId: 99 })).toBeUndefined();
    expect(select(carDetail, 'car.detail', {})).toBeUndefined();
  });
  it('car.telemetry selects the dynamics of one car', () => {
    expect(select(carTelemetry, 'car.telemetry', { carId: 2 })).toEqual(view.state.cars[2]!.dynamics);
    expect(select(carTelemetry, 'car.telemetry', { carId: 99 })).toBeUndefined();
  });
  it('history and insights bindings', () => {
    expect(history.calculators).toEqual([]);
    expect(history.topics).toEqual(['laps', 'stints', 'pitStops', 'flagPhases', 'events'].map((k) => ({ topic: k, fromHistory: k })));
    expect(insights.topics).toEqual([{ topic: 'insights', fromInsights: true }]);
  });
});

describe('what the features read (domain areas)', () => {
  const readsOf = (f: Feature, id: string) => (f.calculators.find((c) => c.id === id) as QuickCalculator<unknown>).reads;
  it.each([
    ['car.detail', carDetail, 'cars.state', ['identity', 'timing', 'tyres', 'energy', 'condition', 'dynamics', 'ownCar', 'stints']],
    ['cars.overview', carsOverview, 'cars.overview', ['identity', 'timing', 'tyres', 'stints']],
    ['car.telemetry', carTelemetry, 'cars.dynamics', ['dynamics']],
    ['session.info', sessionInfo, 'session.info', ['session', 'identity']],
    ['feed.status', feedStatus, 'feed.status', ['feed']],
  ] as const)('%s', (_, feature, id, reads) => {
    expect(readsOf(feature, id)).toEqual(reads);
  });
});
