// Type-level tests (checked by `pnpm typecheck`; the `@ts-expect-error` lines fail the build if they compile).
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CarDynamics, CarMotion, CarState, Celsius, Known, Kmh, Percent, Psi, TyreCorner } from '../src/index.ts';

declare const car: CarState;

describe('hideable car data', () => {
  it('dynamics is Known and must be narrowed before its fields are read', () => {
    expectTypeOf(car.dynamics).toEqualTypeOf<Known<CarDynamics>>();
    const compileOnly = () => {
      // @ts-expect-error speedKmh is not readable before narrowing the Known
      const unnarrowed: Kmh = car.dynamics.speedKmh;
      const narrowed: Kmh | undefined = car.dynamics.known ? car.dynamics.value.speedKmh : undefined;
      return [unnarrowed, narrowed];
    };
    expect(compileOnly).toBeTypeOf('function');
  });
  it('motion is plain and holds the Motion packet fields', () => {
    expectTypeOf(car.motion).toEqualTypeOf<CarMotion>();
    expectTypeOf<keyof CarMotion>().toEqualTypeOf<'position' | 'velocityMps' | 'gForce' | 'orientation'>();
    expectTypeOf<Extract<keyof CarDynamics, keyof CarMotion>>().toEqualTypeOf<never>();
  });
  it('tyre temperatures, pressure, blisters, brake and engine temperatures are Known', () => {
    expectTypeOf<TyreCorner['surfaceTempC']>().toEqualTypeOf<Known<Celsius>>();
    expectTypeOf<TyreCorner['pressurePsi']>().toEqualTypeOf<Known<Psi>>();
    expectTypeOf<TyreCorner['blistersPct']>().toEqualTypeOf<Known<Percent>>();
    expectTypeOf(car.condition.brakes.fl.tempC).toEqualTypeOf<Known<Celsius>>();
    expectTypeOf(car.condition.engineTempC).toEqualTypeOf<Known<Celsius>>();
  });
});
