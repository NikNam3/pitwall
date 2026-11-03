// Shared by the Scheduler tests: history deltas, the feed metrics and the input a scheduler runs on, a scheduler over
// quick calculators that all count as needed, and the scheduler's incremental = from scratch check over frames.
import { expect } from 'vitest';
import {
  activeFlagPhaseOf,
  CalculatorRegistry,
  Scheduler,
  SessionRunner,
  situationOf,
  type Calculator,
  type ChangeTag,
  type EngineView,
  type FeedMetricsView,
  type Frame,
  type HistoryDelta,
  type IncrementalCalculator,
  type QuickCalculator,
  type SchedulerInput,
  type StepResult,
} from '../../src/index.ts';
import { initFor } from './run.ts';

type Lengths = HistoryDelta['before'];

/** History lengths: zero except those given. */
export const len = (o: Partial<Lengths> = {}): Lengths => ({ laps: 0, stints: 0, pitStops: 0, flagPhases: 0, events: 0, crossings: 0, ...o });

/** The history grew (or shrank) from `before` to `after` entries in each of `fields`; `rewound` marks a void fact (C30). */
export const delta = (before = 0, after = before, rewound = false, fields: ReadonlyArray<keyof Lengths> = ['laps']): HistoryDelta => ({
  before: len(Object.fromEntries(fields.map((f) => [f, before]))),
  after: len(Object.fromEntries(fields.map((f) => [f, after]))),
  ...(rewound ? { rewound: { frameId: -1, at: 0 } } : {}),
});

export const feed = { framesClosed: 0, incompleteFrames: 0, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0, packetsPerSecond: 0, connected: true, msSinceLastPacket: 0, lossPercent: 0 } as FeedMetricsView;

/** The situation of the scheduler inputs: the session not paused (the session phase is in the projection's spans, C20). */
export const RACING: SchedulerInput['situation'] = { paused: false };

/** A scheduler input at session time `t`; the state's history holds `laps` laps; `config` is the features' effective config. */
export const input = (t: number, changed: ChangeTag[] = ['timing'], d = delta(), laps = d.after.laps ?? 0, config: SchedulerInput['config'] = {}): SchedulerInput =>
  ({ activeFlagPhase: undefined, situation: RACING, state: { feedId: 'f1', sessionTime: t, history: { laps: new Array(laps).fill({}) } } as never, changed: new Set(changed), delta: d, feed, config });

/** A quick calculator that reads timing, runs every frame and returns the session time, unless `o` says otherwise. */
export const quick = (id: string, o: Partial<QuickCalculator<unknown>> = {}): Calculator =>
  ({ kind: 'quick', id, reads: ['timing'], cadence: 'frame', compute: (v) => v.state.sessionTime, ...o }) as Calculator;

/** A scheduler over `calcs` that needs `needed`; outputs frozen, as in every test (a unit never changes an output it returned). */
export const sched = (calcs: Calculator[], needed = calcs.map((c) => c.id)) => {
  const s = new Scheduler(CalculatorRegistry.build(calcs), { freezeOutputs: true });
  s.setNeeded(needed);
  return s;
};

type Folded = { crossings: number; under: number; events: number };

/** The race's session-phase sub-machine, whose spans `underPhase` reads. */
const RACE_PHASES = 'session-phase-race';

/** A span covers the frame a fact describes (C26): from the frame it opened on up to, not including, the one it closed on. */
const covers = (span: { startFrame: number; endFrame: number }, frame: number): boolean => span.startFrame <= frame && frame < span.endFrame;

/**
 * A reader that folds what happened while a session phase of `kind` stood, as `incidents` does for a neutralisation: it
 * counts the mini-sector crossings, those a closed span of `kind` of `session-phase-race` covers (by the frame each
 * crossing describes, C26), and the events. A pure fold over projection entries (C31): new crossings against every
 * closed span, newly closed spans against the crossings folded before.
 */
export const underPhase = (kind: string): IncrementalCalculator<Folded, Folded> => {
  const spansOf = (v: EngineView) => v.state.history.spans[RACE_PHASES] ?? [];
  const count = (crossings: ReadonlyArray<{ frame: number }>, spans: ReadonlyArray<{ kind: string; startFrame: number; endFrame: number }>): number =>
    crossings.reduce((n, c) => n + spans.filter((s) => s.kind === kind && covers(s, c.frame)).length, 0);
  const fold = (acc: Folded, v: EngineView, d: { crossings: [number, number]; spans: [number, number] }): Folded => {
    const { crossings } = v.state.history;
    const spans = spansOf(v);
    const under = acc.under + count(crossings.slice(d.crossings[0], d.crossings[1]), spans) + count(crossings.slice(0, d.crossings[0]), spans.slice(d.spans[0], d.spans[1]));
    return { crossings: acc.crossings + d.crossings[1] - d.crossings[0], under, events: v.state.history.events.length };
  };
  return {
    kind: 'incremental',
    id: `probe.under.${kind}`,
    reads: ['miniSectors', 'events', `spans:${RACE_PHASES}` as ChangeTag],
    cadence: 'frame',
    init: (v) => fold({ crossings: 0, under: 0, events: 0 }, v, { crossings: [0, v.state.history.crossings.length], spans: [0, 0] }),
    update: (acc, d, v) =>
      fold(acc, v, {
        crossings: [d.before.crossings ?? 0, d.after.crossings ?? 0],
        spans: [d.before[`spans:${RACE_PHASES}`] ?? 0, d.after[`spans:${RACE_PHASES}`] ?? 0],
      }),
    output: (acc) => acc,
  };
};

/** `underPhase` of a neutralisation. */
export const underNeutralisation = underPhase('neutralised');

/**
 * Runs `frames` through a `SessionRunner` and a `Scheduler` that needs `calc` and, on every step it ran, expects its
 * output to equal a fresh `init` over that step's view (incremental = from scratch, docs/testing.md section 5). The
 * scheduler is never reset by hand: only a flashback rewinds (`delta.rewound`, C30).
 */
export function expectScheduledIncremental<Acc, Out>(calc: IncrementalCalculator<Acc, Out>, frames: readonly Frame[]): void {
  const runner = new SessionRunner(initFor([...frames]));
  const scheduler = sched([calc as Calculator]);
  let i = 0;
  const check = (r: StepResult) => {
    const view = { state: r.state, activeFlagPhase: activeFlagPhaseOf(r.state), situation: situationOf(r.state), changed: r.changed, delta: r.delta, feed, config: {} };
    const { ran, outputs } = scheduler.run(view);
    if (ran.includes(calc.id)) expect(outputs.get(calc.id), `frame ${i}`).toEqual(calc.output(calc.init({ ...view, outputs: new Map() })));
    i++;
  };
  for (const frame of frames) runner.apply(frame, check);
  runner.end(check);
}
