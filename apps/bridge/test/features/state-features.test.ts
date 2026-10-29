// apps/bridge/test/features/state-features.test.ts
import { describe, expect, it } from 'vitest';
import type { CarState } from '@pitwall/domain';
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
      tyres: { actualCompound: car.tyres.actualCompound, visualCompound: car.tyres.visualCompound, age: car.tyres.age },
      stops: car.timing.numPitStops, updatedAt: car.updatedAt });
    expect(list[1]!['timing']).not.toBe(car.timing);
    expect(list[1]!['updatedAt']).not.toBe(car.updatedAt);
  });
  it('cars.overview and car.detail carry when each data source last updated the car', () => {
    const car = view.state.cars[1]!;
    // the scenario sends the menu-rate packets (no MotionEx for another car) and one Participants packet, at the session times of its frames
    expect(car.updatedAt).toEqual({ participants: 0, lapData: 32, motion: 32, telemetry: 32, status: 32 });
    expect((out(carsOverview, 'cars.overview') as Array<{ updatedAt: object }>)[1]!.updatedAt).toEqual(car.updatedAt);
    expect((select(carDetail, 'car.detail', { carId: 1 }) as CarState).updatedAt).toEqual(car.updatedAt);
  });
  it('car.detail selects one car by carId', () => {
    expect(select(carDetail, 'car.detail', { carId: 1 })).toEqual(view.state.cars[1]);
    expect(select(carDetail, 'car.detail', { carId: 1 })).not.toBe(view.state.cars[1]);
    // a deep copy: nothing nested is shared with the engine state, which the next frame changes
    const detail = select(carDetail, 'car.detail', { carId: 1 }) as CarState;
    expect(detail.tyres.corners.fl).not.toBe(view.state.cars[1]!.tyres.corners.fl);
    expect(detail.timing).not.toBe(view.state.cars[1]!.timing);
    expect(select(carDetail, 'car.detail', { carId: 99 })).toBeUndefined();
    expect(select(carDetail, 'car.detail', {})).toBeUndefined();
  });
  it('car.telemetry selects the motion and the Known dynamics of one car', () => {
    const car = view.state.cars[2]!;
    expect(select(carTelemetry, 'car.telemetry', { carId: 2 })).toEqual({ motion: car.motion, dynamics: car.dynamics });
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
    ['car.telemetry', carTelemetry, 'cars.dynamics', ['dynamics']],
    ['session.info', sessionInfo, 'session.info', ['session', 'identity']],
    ['feed.status', feedStatus, 'feed.status', ['feed']],
  ] as const)('%s', (_, feature, id, reads) => {
    expect(readsOf(feature, id)).toEqual(reads);
  });
  // `updatedAt` moves with every source, so these two may read more tags than they show fields of; never fewer.
  it.each([
    ['car.detail', carDetail, 'cars.state', ['identity', 'timing', 'tyres', 'energy', 'condition', 'dynamics', 'ownCar', 'stints']],
    ['cars.overview', carsOverview, 'cars.overview', ['identity', 'timing', 'tyres', 'stints', 'pitStops']],
  ] as const)('%s reads at least the areas of its fields', (_, feature, id, reads) => {
    expect(readsOf(feature, id)).toEqual(expect.arrayContaining([...reads]));
  });
});
