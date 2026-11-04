// An incremental unit as its tests step it (contract C31.2, ruling Task 22 round 3): its accumulator folds the
// projection and the config, and `output(acc, view)` combines it with the view's live state and open spans. A test
// keeps the accumulator together with the view it last saw, so `output` gets the same view as the `init` or `update`
// before it. `init` and `update` are the unit's own, a rewound delta included; the view is passed as given (a test
// that guards it, C41, passes its guarded view).
import type { EngineView, HistoryDelta, IncrementalCalculator } from '@pitwall/engine/readers';

/** A unit's accumulator and the view it was last folded on. */
export type Stepped<A> = { readonly acc: A; readonly view: EngineView };

/** `init`, `update` and `output` of an incremental unit, with the view carried from the fold to the output. */
export type Scheduled<A, O> = {
  init(view: EngineView): Stepped<A>;
  update(state: Stepped<A>, delta: HistoryDelta, view: EngineView): Stepped<A>;
  output(state: Stepped<A>): O;
};

/** `calc` stepped as above. */
export function scheduled<A, O>(calc: IncrementalCalculator<A, O>): Scheduled<A, O> {
  return {
    init: (view) => ({ acc: calc.init(view), view }),
    update: (state, delta, view) => ({ acc: calc.update(state.acc, delta, view), view }),
    output: ({ acc, view }) => calc.output(acc, view),
  };
}
