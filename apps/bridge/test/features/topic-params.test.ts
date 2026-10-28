// Supervisor ruling: each feature validates its subscribe params in `select`; bad params give `undefined` and never throw.
import { describe, expect, it } from 'vitest';
import type { QuickCalculator } from '@pitwall/engine';
import type { Feature, TopicBinding } from '../../src/features/feature.ts';
import carDetail from '../../src/features/car-detail/register.ts';
import carTelemetry from '../../src/features/car-telemetry/register.ts';
import { ScenarioBuilder } from '../../../../packages/engine/test/builders/index.ts';
import { viewFrom } from '../helpers/view.ts';

const view = viewFrom(new ScenarioBuilder({ cars: 3, player: 2 }).session().participants().frames(3, () => {}).build());
const select = (f: Feature, topic: string, params: unknown): unknown => {
  const b = f.topics.find((t) => t.topic === topic) as Extract<TopicBinding, { from: string }>;
  const calc = f.calculators.find((c) => c.id === b.from) as QuickCalculator<unknown>;
  return b.select?.(calc.compute(view), params as object);
};

const cases = [
  { feature: carDetail, topic: 'car.detail', expected: (id: number) => view.state.cars[id] },
  { feature: carTelemetry, topic: 'car.telemetry', expected: (id: number) => view.state.cars[id]!.dynamics },
];

// `state.cars` holds every slot of the game (22), so the valid range is 0 .. cars.length - 1.
describe.each(cases)('$topic params', ({ feature, topic, expected }) => {
  const pick = (params: unknown) => select(feature, topic, params);

  it('accepts every carId in range', () => {
    for (const id of [0, 1, 2, view.state.cars.length - 1]) expect(pick({ carId: id })).toEqual(expected(id));
  });
  it.each([
    ['one past the last slot', { carId: view.state.cars.length }],
    ['negative', { carId: -1 }],
    ['fractional', { carId: 1.5 }],
    ['NaN', { carId: Number.NaN }],
    ['Infinity', { carId: Number.POSITIVE_INFINITY }],
    ['numeric string', { carId: '1' }],
    ['boolean', { carId: true }],
    ['null', { carId: null }],
    ['array', { carId: [1] }],
    ['object', { carId: { valueOf: () => 1 } }],
    ['missing', {}],
  ])('carId %s gives undefined', (_name, params) => {
    expect(pick(params)).toBeUndefined();
  });
  it.each([['null', null], ['undefined', undefined], ['a string', '1'], ['a number', 1], ['an array', [1]]])(
    'params that are %s give undefined and do not throw',
    (_name, params) => {
      expect(() => pick(params)).not.toThrow();
      expect(pick(params)).toBeUndefined();
    },
  );
  it('ignores keys other than carId', () => {
    expect(pick({ carId: 1, extra: 'x', nested: { carId: 0 }, toString: 5 })).toEqual(expected(1));
    expect(pick({ car: 1, id: 1, index: 1 })).toBeUndefined();
  });
  it('an own __proto__ key is ignored and pollutes nothing', () => {
    const onlyProto = JSON.parse('{"__proto__":{"carId":1}}') as object;
    const withCarId = JSON.parse('{"carId":1,"__proto__":{"carId":0,"polluted":true}}') as object;
    expect(Object.hasOwn(onlyProto, '__proto__')).toBe(true);
    expect(pick(onlyProto)).toBeUndefined();
    expect(pick(withCarId)).toEqual(expected(1));
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(({} as Record<string, unknown>)['carId']).toBeUndefined();
  });
  it('does not change the params it is given', () => {
    const params = Object.freeze({ carId: 1, extra: 'x' });
    expect(() => pick(params)).not.toThrow();
    expect(params).toEqual({ carId: 1, extra: 'x' });
  });
});
