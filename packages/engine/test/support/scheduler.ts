// Shared by the Scheduler tests: history deltas, the feed metrics and the input a scheduler runs on, and a scheduler
// over quick calculators that all count as needed.
import { CalculatorRegistry, Scheduler, type Calculator, type ChangeTag, type FeedMetricsView, type HistoryDelta, type QuickCalculator, type SchedulerInput } from '../../src/index.ts';

type Lengths = HistoryDelta['before'];

/** History lengths: zero except those given. */
export const len = (o: Partial<Lengths> = {}): Lengths => ({ laps: 0, stints: 0, pitStops: 0, flagPhases: 0, events: 0, miniSectors: 0, ...o });

/** The history grew (or shrank) from `before` to `after` entries in each of `fields`. */
export const delta = (before = 0, after = before, truncated = false, fields: ReadonlyArray<keyof Lengths> = ['laps']): HistoryDelta => ({
  before: len(Object.fromEntries(fields.map((f) => [f, before]))),
  after: len(Object.fromEntries(fields.map((f) => [f, after]))),
  truncated,
});

export const feed = { framesClosed: 0, incompleteFrames: 0, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0, packetsPerSecond: 0, connected: true, msSinceLastPacket: 0, lossPercent: 0 } as FeedMetricsView;

/** A scheduler input at session time `t`; the state's history holds `laps` laps; `config` is the features' effective config. */
export const input = (t: number, changed: ChangeTag[] = ['timing'], d = delta(), laps = d.after.laps, config: SchedulerInput['config'] = {}): SchedulerInput =>
  ({ state: { feedId: 'f1', sessionTime: t, history: { laps: new Array(laps).fill({}) } } as never, changed: new Set(changed), delta: d, feed, config });

/** A quick calculator that reads timing, runs every frame and returns the session time, unless `o` says otherwise. */
export const quick = (id: string, o: Partial<QuickCalculator<unknown>> = {}): Calculator =>
  ({ kind: 'quick', id, reads: ['timing'], cadence: 'frame', compute: (v) => v.state.sessionTime, ...o }) as Calculator;

export const sched = (calcs: Calculator[], needed = calcs.map((c) => c.id)) => {
  const s = new Scheduler(CalculatorRegistry.build(calcs));
  s.setNeeded(needed);
  return s;
};
