import type { Insight, SessionTime } from '@pitwall/domain';
import type { FrameMetrics } from '../frame/metrics.ts';
import type { HistoryDelta, Projection } from '../log/types.ts';
import type { Situation } from '../situations/situation.ts';
import type { LiveState } from '../state/live-state.ts';
import type { WeekendContext } from '../state/weekend-context.ts';
import type { ChangeTag } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

export type CalculatorId = string;

/** When a calculator is due, measured in session time (spec 7.3). */
export type Cadence = 'frame' | { hz: number } | 'lapCompleted' | 'pitStop' | 'sessionChange';

/** What a calculator reads: a part of the engine state, the feed health, or another calculator's output. */
export type Dependency = ChangeTag | 'feed' | { calculator: CalculatorId };

/** Feed health: the frame counters plus what the bridge's feed monitor measures. */
export type FeedMetricsView = FrameMetrics & {
  packetsPerSecond: number;
  latencyMs?: number;
  connected: boolean;
  msSinceLastPacket: number;
  /** Incomplete over closed frames in the last 10 s of receive time, 0..100. */
  lossPercent: number;
  /** Closed frames that `lossPercent` is measured over; a small sample says little. Absent when the feed does not count them. */
  lossWindowFrames?: number;
  /** The `packetFormat` of a wrong-format packet seen in the last 10 s. */
  wrongFormat?: number;
};

/**
 * Everything a calculator or analysis may see (C39), read-only: the live state, the situation (the machine's open spans
 * and the weekend phase, C20), the history (the projection, C28; with `situation` it answers membership, so the view is
 * a `MembershipSource`, C26), the delta and change tags, the weekend's earlier sessions, the config, the priors, the feed
 * health and the outputs of the units it reads.
 */
export type EngineView = {
  /** The live state (C8): values only; no open trackers, log, signals (C13), projection or frame number. */
  live: DeepReadonly<LiveState>;
  /** The machine's open spans by sub-machine and the weekend phase (C20); closed spans are in `history.spans`. */
  situation: Situation;
  /** The projection (C28): the log as readers see it, closed spans by sub-machine included. */
  history: Projection;
  delta: HistoryDelta;
  changed: ReadonlySet<ChangeTag>;
  /** The projections of the weekend's earlier sessions (C62); absent until the weekend context is known. */
  weekend: DeepReadonly<WeekendContext> | undefined;
  /** The effective config of the run, by section key (see `defineConfig`); fixed for the run (C47). */
  config: DeepReadonly<Record<string, Record<string, number | string | boolean>>>;
  /** Season-wide priors (C62a), fixed for the run; `{}` until the priors store exists. */
  priors: DeepReadonly<Record<string, unknown>>;
  feed: FeedMetricsView;
  /** Outputs of the calculators run before this one in the same pass. */
  outputs: ReadonlyMap<CalculatorId, unknown>;
};

type CalculatorBase = {
  id: CalculatorId;
  reads: Dependency[];
  cadence: Cadence;
};

/** Pure, no state. */
export type QuickCalculator<Out> = CalculatorBase & {
  kind: 'quick';
  compute(view: EngineView): Out;
  insights?(out: Out, prev: Out | undefined, view: EngineView): Insight[];
};

/**
 * State allowed only as an accumulator (C31): a pure fold over projection entries and config, so `init` over the
 * projection equals `update` step by step. `output` combines the fold with the frame's view (live state, open spans).
 */
export type IncrementalCalculator<Acc, Out> = CalculatorBase & {
  kind: 'incremental';
  /** From scratch over the existing projection. */
  init(view: EngineView): Acc;
  update(acc: Acc, delta: HistoryDelta, view: EngineView): Acc;
  output(acc: Acc, view: EngineView): Out;
  insights?(out: Out, prev: Out | undefined, view: EngineView): Insight[];
};

/** Method syntax above keeps `QuickCalculator<X>` assignable to the `unknown` form. */
export type Calculator = QuickCalculator<unknown> | IncrementalCalculator<unknown, unknown>;

/**
 * An expensive, asynchronous computation (later Monte Carlo). The bridge turns it into the quick calculator
 * `job:<id>` (these `reads`, `cadence: trigger`, `compute: prepare`), so the scheduler decides when it is due and
 * demand whether it is needed. `prepare` extracts a structured-cloneable input from the view; the module at `module`
 * exports `run(input, rng)` and runs in a worker thread. `Out` is what `run` resolves to.
 */
export type Job<In, Out> = {
  kind: 'job';
  id: CalculatorId;
  reads: Dependency[];
  trigger: Cadence;
  prepare(view: EngineView): In;
  module: URL;
  /** Phantom marker that ties `Out` to the job; never set. */
  readonly out?: Out;
};

/** A raised insight, or the key of one that no longer holds. */
export type InsightChange = { type: 'raised'; insight: Insight } | { type: 'resolved'; key: string; at: SessionTime };
