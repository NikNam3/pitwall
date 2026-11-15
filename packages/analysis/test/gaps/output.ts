// `gaps`' output for the tests of the units that read it (SP4.3c Task 6, O10): a hand-built one (`gapsOutput`) where a
// view has no crossings, and the calculator's own over a view (`gapsOf`) where it has.
import { unknown, type CarId } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import { GAPS, type GapsOutput } from '../../src/gaps/index.ts';

/** An empty output (no car, nothing received), with `over` set. */
export const gapsOutput = (over: Partial<GapsOutput> = {}): GapsOutput => ({
  intervals: [],
  lineTimes: {},
  recent: {},
  fine: {},
  gapperWindow: { ours: [], others: [] },
  neighbourhood: [],
  raceStartAt: unknown('notReceived'),
  outOfRace: [],
  phases: [],
  leaderProgress: unknown('notReceived'),
  ...over,
});

/** The order `ids` as intervals: the leader first; the gaps are not what these tests read. */
export const orderOf = (ids: readonly CarId[]): GapsOutput['intervals'] =>
  ids.map((carId) => ({ carId, toLeaderMs: unknown('notReceived'), toAheadMs: unknown('notReceived'), toBehindMs: unknown('notReceived'), lapsDown: 0, positionsGained: unknown('notApplicable') }));

/** `gaps`' output over `view` as a fresh run computes it. */
export const gapsOf = (view: EngineView): GapsOutput => gapsCalculator.output(gapsCalculator.init(view), view);

/** `view` with `gaps`' output among its outputs: `out`, else computed over the view (`gapsOf`). */
export const withGaps = (view: EngineView, out: GapsOutput = gapsOf(view)): EngineView => ({ ...view, outputs: new Map([...view.outputs, [GAPS, out]]) });
