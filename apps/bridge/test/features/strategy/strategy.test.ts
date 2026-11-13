// The `strategy` feature (SP4.3b spec §8.1, plan 4.3b1 Task 20 rows 5, 6 and 7; C30, C49, C51): its job is wired as the
// bridge wires every job (`FeedJobs`: the trigger calculator `job:strategy`, run by the scheduler on demand, then in a
// worker seeded by `jobSeed`). Driven frame by frame over a short generator race seen from our two cars, with the
// change tags each frame sets (the lists that grew, the sub-machines whose spans changed):
//  - the seed: the worker's output for a frame equals an in-process run with that frame's `jobSeed`, twice, and a feed
//    that reprocesses only up to that frame (the CLI's path, `pitwall strategy`) gets the same output;
//  - on demand: the trigger runs only while `strategy.plans` is subscribed: at once on frame 1, newly needed (C49), then
//    at every frame with a lap record of one of our cars, a stop, a change of the race's session phase or a decision;
//  - a rewind: the run under way is cancelled, the rewound frame re-triggers the job (C30), and a plan committed after
//    the rewind's target no longer counts (C27a): the output equals the one of a run that never received it.
import type { TopicName } from '@pitwall/contracts';
import type { CarId, FrameNumber, StrategyOutput } from '@pitwall/domain';
import { createRng, type EngineView } from '@pitwall/engine/readers';
import { CalculatorRegistry, projectionLengths, Scheduler, type SchedulerInput } from '@pitwall/engine';
import { prepareStrategy, runStrategy, STRATEGY_JOB } from '@pitwall/analysis';
import { afterEach, describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/features/feature.ts';
import { FEATURES } from '../../../src/features/index.generated.ts';
import { FeedJobs, jobCalculatorId } from '../../../src/jobs/feed-jobs.ts';
import { jobSeed, type JobResult } from '../../../src/jobs/job-runner.ts';
import { demandOf } from '../../../src/pipeline/demand.ts';
import { NO_DRIVERS, NO_PRIORS } from '../../../../../test-support/builders/index.ts';
import { generated, OURS, PARAMS, PLAYER, stopIn, viewAtFrame, type ViewSpec } from '../../../../../packages/analysis/test/strategy/support.ts';

const TOPIC: TopicName = 'strategy.plans';
const TRIGGER = jobCalculatorId('strategy');
/** Every feed's jobs, closed after each test. */
const open: FeedJobs[] = [];

/** A short race: the small generator field, 6 laps, one stop each on lap 3 or 4. */
const RACE = generated({ ...PARAMS, laps: 6, field: PARAMS.field.map((car, i) => ({ ...car, stops: [{ lap: 3 + (i % 2), compound: 'hard' as const }] })) });

function featureOf(name: string): Feature {
  const f = FEATURES.find((x) => x.name === name);
  if (f === undefined) throw new Error(`no ${name} feature in the generated feature index`);
  return f;
}

/** The fact lists and the change tag each sets when it grows. */
const LIST_TAGS = { laps: 'laps', stints: 'stints', pitStops: 'pitStops', crossings: 'miniSectors', events: 'events', penalties: 'penalties', decisions: 'decisions', clock: 'clock' } as const;

/** The change tags of the frame from `prev` to `cur`: every list that grew, every sub-machine whose closed or open spans changed. */
function changedOf(prev: EngineView | undefined, cur: EngineView): Set<string> {
  const tags = new Set<string>();
  for (const [list, tag] of Object.entries(LIST_TAGS)) {
    const k = list as keyof typeof LIST_TAGS;
    if (prev === undefined || cur.history[k].length !== prev.history[k].length) tags.add(tag);
  }
  const machines = new Set([...Object.keys(cur.history.spans), ...Object.keys(cur.situation.byMachine)]);
  for (const m of machines) {
    const closed = (v: EngineView | undefined) => v?.history.spans[m]?.length ?? 0;
    const opened = (v: EngineView | undefined) => JSON.stringify(v?.situation.byMachine[m] ?? []);
    if (prev === undefined || closed(prev) !== closed(cur) || opened(prev) !== opened(cur)) tags.add(`spans:${m}`);
  }
  return tags;
}

/** The view after `frame` with `spec` (the plan decisions): no priors snapshot, no profiles, as the scheduler's view of `NO_PRIORS` and `NO_DRIVERS`. */
const viewOf = (frame: FrameNumber, spec: ViewSpec = {}): EngineView => viewAtFrame(RACE, frame, spec);

/** The scheduler's input after `frame`, its change tags from the frame before, its delta optionally replaced. */
function inputOf(frame: FrameNumber, spec: ViewSpec = {}, delta?: SchedulerInput['delta']): SchedulerInput {
  const cur = viewOf(frame, spec);
  const prev = frame > 1 ? viewOf(frame - 1, spec) : undefined;
  const { outputs: _outputs, priors: _priors, drivers: _drivers, ...view } = cur;
  return { ...view, priors: NO_PRIORS, drivers: NO_DRIVERS, changed: changedOf(prev, cur) as SchedulerInput['changed'], ...(delta && { delta }) };
}

/** The frames after the first whose change is one of the job's triggers: a lap record of ours, a stop, the race's session phase, a decision. */
function triggerFrames(spec: ViewSpec = {}, upTo: FrameNumber = RACE.lastFrame): FrameNumber[] {
  const frames: FrameNumber[] = [];
  const ours = new Set<number>(OURS);
  for (let f = 2; f <= upTo; f++) {
    const prev = viewOf(f - 1, spec);
    const cur = viewOf(f, spec);
    const tags = changedOf(prev, cur);
    const ourLap = cur.history.laps.slice(prev.history.laps.length).some((l) => ours.has(l.carId));
    if (ourLap || tags.has('pitStops') || tags.has('spans:session-phase-race') || tags.has('decisions')) frames.push(f);
  }
  return frames;
}

/** One feed's job wiring: the scheduler with the features' demand for `subscribed`, and the job results as they arrive. */
function feed(subscribed: TopicName[]) {
  const strategy = featureOf('strategy');
  const hazard = featureOf('race-hazard');
  const results: JobResult[] = [];
  const waiting: Array<() => void> = [];
  const jobs = new FeedJobs([strategy], (r) => {
    results.push(r);
    waiting.splice(0).forEach((w) => w());
  });
  const registry = CalculatorRegistry.build([...hazard.calculators, ...strategy.calculators, ...jobs.calculators]);
  const scheduler = new Scheduler(registry);
  scheduler.setNeeded(demandOf([strategy, hazard], registry)(new Set(subscribed)));
  const triggered: FrameNumber[] = [];
  /** One pass on `input`; a job whose trigger ran goes to the worker, computed for `frameId`. */
  const pass = (input: SchedulerInput, frameId: number): void => {
    const result = scheduler.run(input);
    expect(result.errors).toEqual([]);
    if (result.ran.includes(TRIGGER)) triggered.push(frameId);
    jobs.triggerRan(result, { lap: 0, frameId });
  };
  /** The first result computed for `frameId` among those arriving from index `from` on. */
  const resultFor = (frameId: number, from = 0): Promise<JobResult> =>
    new Promise((resolve) => {
      const look = (): boolean => {
        const found = results.slice(from).find((r) => r.computedFor.frameId === frameId);
        if (found !== undefined) resolve(found);
        return found !== undefined;
      };
      const wait = () => {
        if (!look()) waiting.push(wait);
      };
      wait();
    });
  open.push(jobs);
  return { pass, triggered, results, resultFor, jobs };
}

const valueOf = (r: JobResult): StrategyOutput => {
  expect(r).not.toHaveProperty('error');
  return (r as { value: StrategyOutput }).value;
};

/** A trigger frame on the leader's lap `lap`. */
const triggerOnLap = (lap: number, spec: ViewSpec = {}): FrameNumber => {
  const frames = new Set(RACE.framesOfLap(lap));
  const f = triggerFrames(spec).find((x) => frames.has(x));
  if (f === undefined) throw new Error(`no trigger frame on lap ${lap}`);
  return f;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((j) => j.close()));
});

describe('strategy feature', () => {
  // row 5
  it("the same jobSeed and input give a bit-identical output; the CLI's path gives the live output for a frame the live job ran on", async () => {
    const at = triggerOnLap(3);
    const live = feed([TOPIC]);
    for (let f = 1; f <= at; f++) live.pass(inputOf(f), f);
    const liveOut = valueOf(await live.resultFor(at));
    for (const car of OURS) expect(liveOut[car]?.known, `car ${car}`).toBe(true);

    // in process, with the frame's seed: twice the same, and the worker's
    const input = prepareStrategy(viewOf(at));
    // ported in SP4.3b Task 25: the job runs in one part per car, part i seeded with jobSeed(…, `${id}/${i}`, …) (Task 24)
    const parts = STRATEGY_JOB.parts;
    if (parts === undefined) throw new Error('strategy runs in parts');
    const inParts = () =>
      parts.merge(parts.split(structuredClone(input)).map((part, i) => runStrategy(part, createRng(jobSeed(0, `${STRATEGY_JOB.id}/${i}`, { lap: 0, frameId: at })))));
    const once = inParts();
    expect(inParts()).toStrictEqual(once);
    expect(once).toEqual(liveOut);

    // the live feed runs on; a feed reprocessing only up to `at` (the CLI's path) gets the live output for it
    for (let f = at + 1; f <= at + 20; f++) live.pass(inputOf(f), f);
    const cli = feed([TOPIC]);
    for (let f = 1; f <= at; f++) cli.pass(inputOf(f), f);
    expect(valueOf(await cli.resultFor(at))).toEqual(liveOut);
  }, 120_000);

  // row 6
  it('on demand: runs only while strategy.plans is subscribed (C49)', async () => {
    const idle = feed([]);
    for (let f = 1; f <= RACE.lastFrame; f++) idle.pass(inputOf(f), f);
    expect(idle.triggered).toEqual([]);

    const demanded = feed([TOPIC]);
    for (let f = 1; f <= RACE.lastFrame; f++) demanded.pass(inputOf(f), f);
    // newly needed, the trigger runs at once on frame 1 (C49), then at each of its changes (spec §8.1)
    const expected = [1, ...triggerFrames()];
    expect(expected.length).toBeGreaterThan(4);
    expect(demanded.triggered).toEqual(expected);
    valueOf(await demanded.resultFor(expected.at(-1)!));
    expect(idle.results).toEqual([]);
  }, 120_000);

  // row 7
  it('a rewind cancels and re-triggers the job; a voided commit no longer counts (C27a, C30)', async () => {
    const target = triggerOnLap(3);
    const commitAt = target + 10;
    const plan = stopIn(viewOf(target), PLAYER, 2);
    const spec: ViewSpec = { decisions: [{ kind: 'planCommitted', carId: PLAYER, policy: plan, frame: commitAt }] };
    const committedRows = (out: StrategyOutput, car: CarId) => {
      const r = out[car];
      return r?.known ? r.value.rows.filter((row) => row.committed) : [];
    };

    // the run that never received the frames after the target
    const clean = feed([TOPIC]);
    for (let f = 1; f <= target; f++) clean.pass(inputOf(f, spec), f);
    const expected = valueOf(await clean.resultFor(target));
    expect(committedRows(expected, PLAYER)).toEqual([]);

    // the run that went on: the commit counts on its frame
    const rewound = feed([TOPIC]);
    for (let f = 1; f <= commitAt; f++) rewound.pass(inputOf(f, spec), f);
    expect(rewound.triggered.at(-1)).toBe(commitAt);
    expect(committedRows(valueOf(await rewound.resultFor(commitAt)), PLAYER).map((r) => r.policy)).toEqual([plan]);

    // one more trigger starts a run; the flashback to the target cancels it, the rewound frame re-triggers
    const next = triggerFrames(spec).find((f) => f > commitAt)!;
    for (let f = commitAt + 1; f <= next; f++) rewound.pass(inputOf(f, spec), f);
    expect(rewound.triggered.at(-1)).toBe(next);
    rewound.jobs.flashback();
    const since = rewound.results.length;
    const atTarget = RACE.viewAt(target).live.sessionTime;
    const delta = { before: projectionLengths(viewOf(next, spec).history), after: projectionLengths(viewOf(target, spec).history), rewound: { frameId: target, at: atTarget } };
    rewound.pass(inputOf(target, spec, delta), target);
    expect(rewound.triggered.at(-1)).toBe(target);
    const after = valueOf(await rewound.resultFor(target, since));
    // the commit after the target never happened (C27a): the output is the clean run's
    expect(committedRows(after, PLAYER)).toEqual([]);
    expect(after).toEqual(expected);
    // the cancelled run never delivered
    expect(rewound.results.slice(since).map((r) => r.computedFor.frameId)).toEqual([target]);
  }, 120_000);
});
