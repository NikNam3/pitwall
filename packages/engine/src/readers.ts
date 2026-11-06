// The engine as its readers see it (contract C6): analyses, the bridge's storage, hub, features and publishing, and the
// UI. Only domain-level types and protocol-free helpers; nothing here reaches `frame/frame.ts` or `@pitwall/protocol`
// (depcruise `readers-never-reach-the-game`). The adapter side (frames, `step`, the runner) is the package's main entry.
export type * from './state/engine-state.ts';
export type * from './state/weekend-context.ts';
export type { LiveState } from './state/live-state.ts';
export type * from './util/deep-readonly.ts';
export type { FrameMetrics } from './frame/metrics.ts';
export { CalculatorRegistry, RegistryError, type RegistryErrorReason } from './calc/registry.ts';
export { defineConfig, type ConfigKey, type ConfigShape, type ConfigValue } from './calc/config.ts';
export { definePriors, priorsOf, type FallbackCtx, type PriorDecl, type PriorsCtx, type PriorsDecl, type StoredSource } from './calc/priors.ts';
export { openSpansOf } from './calc/situation.ts';
export { InsightBook } from './calc/insight-book.ts';
export type { OnCalculatorRun, SchedulerBookkeeping, SchedulerInput, SchedulerOptions, SchedulerResult } from './calc/scheduler.ts';
export type {
  Cadence,
  Calculator,
  CalculatorId,
  Dependency,
  EngineView,
  FeedMetricsView,
  IncrementalCalculator,
  InsightChange,
  Job,
  QuickCalculator,
} from './calc/types.ts';
export { createRng, type Rng } from './util/rng.ts';
export { copyPlain } from './util/copy-plain.ts';
export { ALL_CHANGE_TAGS, CHANGE_TAGS, type ChangeTag, type ClockFall, type ClockJump, type LapCorrection, type StepOutput } from './step/types.ts';
export { membershipOf, projectionLengths, situationAt, type MembershipSource } from './log/projection.ts';
export type { HistoryDelta, LogLengths, Projection, ProjectedList, ProjectionState } from './log/types.ts';
export { unknownLapEnd, type LapEndSamples } from './recorders/lap-samples.ts';
export { CAR_STATUS, carsInSessionOf } from './situations/car-status/in-session.ts';
export type { Situation } from './situations/situation.ts';
