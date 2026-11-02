// Shared by the Scheduler tests: history deltas, the feed metrics and the input a scheduler runs on, a scheduler over
// quick calculators that all count as needed, and the scheduler's incremental = from scratch check over frames.
import { expect } from 'vitest';
import type { SessionPhaseKind } from '@pitwall/domain';
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
} from '../../src/index.ts';
import { initFor } from './run.ts';

type Lengths = HistoryDelta['before'];

/** History lengths: zero except those given. */
export const len = (o: Partial<Lengths> = {}): Lengths => ({ laps: 0, stints: 0, pitStops: 0, flagPhases: 0, sessionPhases: 0, pauses: 0, events: 0, crossings: 0, ...o });

/** The history grew (or shrank) from `before` to `after` entries in each of `fields`; `rewound` marks a void fact (C30). */
export const delta = (before = 0, after = before, rewound = false, fields: ReadonlyArray<keyof Lengths> = ['laps']): HistoryDelta => ({
  before: len(Object.fromEntries(fields.map((f) => [f, before]))),
  after: len(Object.fromEntries(fields.map((f) => [f, after]))),
  ...(rewound ? { rewound: { frameId: -1, at: 0 } } : {}),
});

export const feed = { framesClosed: 0, incompleteFrames: 0, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0, packetsPerSecond: 0, connected: true, msSinceLastPacket: 0, lossPercent: 0 } as FeedMetricsView;

/** The situation of the scheduler inputs: a race under way since session time 0. */
export const RACING: SchedulerInput['situation'] = { session: { kind: 'racing', start: 0, startLeaderLap: 1 }, paused: false };

/** A scheduler input at session time `t`; the state's history holds `laps` laps; `config` is the features' effective config. */
export const input = (t: number, changed: ChangeTag[] = ['timing'], d = delta(), laps = d.after.laps ?? 0, config: SchedulerInput['config'] = {}): SchedulerInput =>
  ({ activeFlagPhase: undefined, situation: RACING, state: { feedId: 'f1', sessionTime: t, history: { laps: new Array(laps).fill({}) } } as never, changed: new Set(changed), delta: d, feed, config });

/** A quick calculator that reads timing, runs every frame and returns the session time, unless `o` says otherwise. */
export const quick = (id: string, o: Partial<QuickCalculator<unknown>> = {}): Calculator =>
  ({ kind: 'quick', id, reads: ['timing'], cadence: 'frame', compute: (v) => v.state.sessionTime, ...o }) as Calculator;

export const sched = (calcs: Calculator[], needed = calcs.map((c) => c.id)) => {
  const s = new Scheduler(CalculatorRegistry.build(calcs));
  s.setNeeded(needed);
  return s;
};

type Folded = { crossings: number; under: number; events: number };

/**
 * A reader that folds what happened while a session phase of `kind` stood, as `incidents` does for a neutralisation: it
 * counts the mini-sector crossings, those a span of `kind` covers (a closed one, or the one in progress from its start
 * on), and the events.
 */
export const underPhase = (kind: SessionPhaseKind): IncrementalCalculator<Folded, Folded> => {
  const covered = (v: EngineView, at: number): boolean =>
    v.state.history.sessionPhases.some((p) => p.kind === kind && p.start <= at && at < p.end) ||
    (v.situation.session.kind === kind && at >= v.situation.session.start);
  const fold = (acc: Folded, v: EngineView, from: number, to: number): Folded => {
    let under = acc.under;
    for (const c of v.state.history.crossings.slice(from, to)) if (covered(v, c.at)) under++;
    return { crossings: acc.crossings + to - from, under, events: v.state.history.events.length };
  };
  return {
    kind: 'incremental',
    id: `probe.under.${kind}`,
    reads: ['miniSectors', 'events', 'sessionPhases'],
    cadence: 'frame',
    init: (v) => fold({ crossings: 0, under: 0, events: 0 }, v, 0, v.state.history.crossings.length),
    update: (acc, d, v) => fold(acc, v, d.before.crossings ?? 0, d.after.crossings ?? 0),
    output: (acc) => acc,
  };
};

/** `underPhase` of a neutralisation. */
export const underNeutralisation = underPhase('neutralised');

/**
 * Runs `frames` through a `SessionRunner` and a `Scheduler` that needs `calc` and, on every step it ran, expects its
 * output to equal a fresh `init` over that step's view (incremental = from scratch, docs/testing.md section 5). The
 * scheduler is never reset by hand: a step that discarded history must say so in its delta.
 */
export function expectScheduledIncremental<Acc, Out>(calc: IncrementalCalculator<Acc, Out>, frames: readonly Frame[]): void {
  const runner = new SessionRunner(initFor([...frames]));
  const scheduler = sched([calc as Calculator]);
  frames.forEach((frame, i) => {
    const r = runner.apply(frame);
    const view = { state: r.state, activeFlagPhase: activeFlagPhaseOf(r.state), situation: situationOf(r.state), changed: r.changed, delta: r.delta, feed, config: {} };
    const { ran, outputs } = scheduler.run(view);
    if (ran.includes(calc.id)) expect(outputs.get(calc.id), `frame ${i}`).toEqual(calc.output(calc.init({ ...view, outputs: new Map() })));
  });
}
