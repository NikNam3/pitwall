import { expect, expectTypeOf, it } from 'vitest';
import type { CarId, Known } from '@pitwall/domain';
import type { DeepReadonly, EngineState } from '../../src/index.ts';

type S = {
  id: CarId;
  list: Array<{ n: number }>;
  pair: [number, number];
  map: Map<string, { v: number }>;
  k: Known<number>;
  fn: (x: number) => number;
};

it('DeepReadonly forbids mutation at every depth and keeps brands and functions', () => {
  const mutate = (s: DeepReadonly<S>) => {
    // @ts-expect-error top-level field
    s.id = 1 as CarId;
    // @ts-expect-error array push on readonly array
    s.list.push({ n: 1 });
    // @ts-expect-error nested object in array
    s.list[0]!.n = 2;
    // @ts-expect-error tuple element
    s.pair[0] = 1;
    // @ts-expect-error map set on readonly map
    s.map.set('a', { v: 1 });
  };
  expect(mutate).toBeTypeOf('function');
  expectTypeOf<DeepReadonly<S>['id']>().toEqualTypeOf<CarId>();
  expectTypeOf<DeepReadonly<S>['fn']>().toEqualTypeOf<(x: number) => number>();
  expectTypeOf<DeepReadonly<EngineState>['cars'][number]['identity']['name']>().toEqualTypeOf<string>();
});
