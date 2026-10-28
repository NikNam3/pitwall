import { describe, expectTypeOf, it } from 'vitest';
import type { EngineState } from '../../src/index.ts';
import type { EngineView, QuickCalculator } from '../../src/index.ts';

describe('EngineView', () => {
  it('hides the in-progress trackers (`open`) from calculators', () => {
    const calc: QuickCalculator<number> = {
      kind: 'quick', id: 'x', reads: ['timing'], cadence: 'frame',
      compute: (view) => {
        // @ts-expect-error `open` is the engine's own in-progress state; a calculator's view has no such field
        void view.state.open;
        return view.state.sessionTime;
      },
    };
    expectTypeOf(calc.compute).parameter(0).toEqualTypeOf<EngineView>();
  });
  it('keeps every other part of the engine state readable', () => {
    expectTypeOf<EngineView['state']['sessionTime']>().toEqualTypeOf<EngineState['sessionTime']>();
    expectTypeOf<keyof EngineView['state']>().toEqualTypeOf<Exclude<keyof EngineState, 'open'>>();
  });
});
