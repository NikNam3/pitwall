// A unit split into a fold and a quick reader (contract C31.2, ruling Task 22 round 2): `<unit>-history` folds the
// projection and the config; `<unit>` is quick and reads the fold's output (`view.outputs`), the live state and the open
// spans. Its tests run the pair as the scheduler does, through one object with the old incremental shape: `init` and
// `update` run the fold (initialised again on a rewind, C30) and then the quick unit on the same view; `output` gives
// the quick unit's output. Each part sees the view through its own guarded view (C41).
import type { Dependency, EngineView, HistoryDelta, IncrementalCalculator, QuickCalculator } from '@pitwall/engine/readers';
import { guardedView } from '../../engine/test/support/scheduler.ts';

/** What a split unit holds between two views: its fold's accumulator and the quick unit's output on the latest view. */
export type SplitState<O> = { readonly fold: unknown; readonly out: O };

/** A split unit run as the scheduler runs its two parts. */
export type SplitUnit<O> = {
  /** The quick unit's id: the unit's. */
  id: string;
  init(view: EngineView): SplitState<O>;
  update(state: SplitState<O>, delta: HistoryDelta, view: EngineView): SplitState<O>;
  output(state: SplitState<O>): O;
  /** What the two parts read, together (C41). */
  reads(): Dependency[];
};

/** Why a split unit cannot run yet: the pair is not there in its shape (round 2 ruling). */
const notSplit = (quick: { id?: string; kind?: string } | undefined, fold: { id?: string; kind?: string } | undefined): string | undefined => {
  if (quick?.kind !== 'quick') return `${quick?.id ?? 'the unit'} is not quick (it is ${quick?.kind ?? 'missing'}): it reads its fold's output (C31.2)`;
  if (fold?.kind !== 'incremental') return `${quick.id}-history is ${fold === undefined ? 'missing' : `not incremental (${fold.kind})`}: the fold over the projection (C31.2)`;
  if (fold.id !== `${quick.id}-history`) return `the fold of ${quick.id} is ${fold.id}, not ${quick.id}-history`;
  return undefined;
};

/** `quick` reading `fold` (`<unit>-history`), run as one unit (see the file comment). */
export function split<O>(quick: QuickCalculator<O>, fold: IncrementalCalculator<unknown, unknown>): SplitUnit<O> {
  const check = (): void => {
    const why = notSplit(quick, fold);
    if (why !== undefined) throw new Error(why);
  };
  const read = (acc: unknown, view: EngineView): SplitState<O> => {
    const outputs = new Map(view.outputs);
    outputs.set(fold.id, fold.output(acc));
    return { fold: acc, out: quick.compute(guardedView({ ...view, outputs }, quick.reads, { unit: quick.id })) };
  };
  const foldView = (view: EngineView): EngineView => guardedView(view, fold.reads, { unit: fold.id });
  return {
    id: quick.id,
    init(view) {
      check();
      return read(fold.init(foldView(view)), view);
    },
    update(state, delta, view) {
      check();
      const v = { ...view, delta };
      return read(delta.rewound !== undefined ? fold.init(foldView(v)) : fold.update(state.fold, delta, foldView(v)), v);
    },
    output: (state) => state.out,
    reads() {
      check();
      const seen = new Set<string>();
      return [...quick.reads, ...fold.reads].filter((r) => {
        const key = JSON.stringify(r);
        return !seen.has(key) && (seen.add(key), true);
      });
    },
  };
}
