import type { Insight, SessionTime } from '@pitwall/domain';
import type { FrameMetrics } from '../frame/metrics.ts';
import type { HistoryDelta } from '../history/delta.ts';
import type { EngineState } from '../state/engine-state.ts';
import type { ChangeTag } from '../step/step.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

export type CalculatorId = string;

/** When a calculator is due, measured in session time (spec 7.3). */
export type Cadence = 'frame' | { hz: number } | 'lapCompleted' | 'pitStop' | 'flagChange' | 'sessionChange';

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

/** Everything a calculator may look at: read-only. */
export type EngineView = {
  state: DeepReadonly<EngineState>;
  changed: ReadonlySet<ChangeTag>;
  delta: HistoryDelta;
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

/** State allowed, but always a fold over a history prefix: `init` over the history equals `update` step by step. */
export type IncrementalCalculator<Acc, Out> = CalculatorBase & {
  kind: 'incremental';
  /** From scratch over the existing history. */
  init(view: EngineView): Acc;
  update(acc: Acc, delta: HistoryDelta, view: EngineView): Acc;
  output(acc: Acc): Out;
  insights?(out: Out, prev: Out | undefined, view: EngineView): Insight[];
};

/** Method syntax above keeps `QuickCalculator<X>` assignable to the `unknown` form. */
export type Calculator = QuickCalculator<unknown> | IncrementalCalculator<unknown, unknown>;

/** A raised insight, or the key of one that no longer holds. */
export type InsightChange = { type: 'raised'; insight: Insight } | { type: 'resolved'; key: string; at: SessionTime };
