// The `sc-call` feature (SP4.3b spec §9.3; plan SP4.3b2 Task 9 rows 6, 7, 8 and 13; C14, C30, C49, C51): its job is
// wired as the bridge wires every job (`FeedJobs`: the trigger calculator `job:sc-call`, run by the scheduler on
// demand, then in a worker seeded by `jobSeed`), with `rejoin` and `race-hazard` computed by the scheduler upstream
// (the features `rejoin`, `pit-loss`, `gaps`, `race-hazard`). Driven frame by frame over a short generator race seen
// from our two cars, with the change tags each frame sets (as `strategy`'s feature test):
//  - the seed: the worker's output for a frame equals an in-process `run` of the trigger's input with that frame's
//    `jobSeed`, twice;
//  - a rewind: the run under way is cancelled, the rewound frame re-triggers the job (C30), and its output equals the
//    one of a run that never received the undone frames;
//  - outside the race phase both rows are `notApplicable` with our car present; the trigger runs only while
//    `scCall.car` is subscribed (C49);
//  - the trigger is `strategy`'s (`ourLap`, a line crossing of ours): a mini-sector crossing alone does not run it.
import type { TopicName } from '@pitwall/contracts';
import type { CarId, FrameNumber, ScCall } from '@pitwall/domain';
import { createRng, type EngineView } from '@pitwall/engine/readers';
import { CalculatorRegistry, projectionLengths, Scheduler, type SchedulerInput } from '@pitwall/engine';
import { SC_CALL_JOB, STRATEGY_TRIGGER, type ScCallInput } from '@pitwall/analysis';
import { afterEach, describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/features/feature.ts';
import { FEATURES } from '../../../src/features/index.generated.ts';
import { FeedJobs, jobCalculatorId } from '../../../src/jobs/feed-jobs.ts';
import { jobSeed, type JobResult } from '../../../src/jobs/job-runner.ts';
import { demandOf } from '../../../src/pipeline/demand.ts';
import { NO_DRIVERS, NO_PRIORS } from '../../../../../test-support/builders/index.ts';
import { generated, OURS, PARAMS } from '../../../../../packages/analysis/test/strategy/support.ts';
import { ALL_NOT_APPLICABLE, knownsOf, scViewAtFrame, type ScViewSpec } from '../../../../../packages/analysis/test/sc-call/support.ts';

const TOPIC: TopicName = 'scCall.car';
const TRIGGER = jobCalculatorId('sc-call');
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

/** The view after `frame` with `spec`; the scheduler computes every output itself. */
const viewOf = (frame: FrameNumber, spec: ScViewSpec = {}): EngineView => scViewAtFrame(RACE, frame, spec);

/** The scheduler's input after `frame`, its change tags from the frame before, its delta optionally replaced. */
function inputOf(frame: FrameNumber, spec: ScViewSpec = {}, delta?: SchedulerInput['delta']): SchedulerInput {
  const cur = viewOf(frame, spec);
  const prev = frame > 1 ? viewOf((frame - 1) as FrameNumber, spec) : undefined;
  const { outputs: _outputs, priors: _priors, drivers: _drivers, ...view } = cur;
  return { ...view, priors: NO_PRIORS, drivers: NO_DRIVERS, changed: changedOf(prev, cur) as SchedulerInput['changed'], ...(delta && { delta }) };
}

/** Per frame after the first: whether one of our cars got a lap record, and the change tags. */
function framesOf(spec: ScViewSpec = {}): { frame: FrameNumber; ourLap: boolean; tags: Set<string> }[] {
  const out: { frame: FrameNumber; ourLap: boolean; tags: Set<string> }[] = [];
  const ours = new Set<number>(OURS);
  for (let f = 2; f <= RACE.lastFrame; f++) {
    const frame = f as FrameNumber;
    const prev = viewOf((f - 1) as FrameNumber, spec);
    const cur = viewOf(frame, spec);
    const ourLap = cur.history.laps.slice(prev.history.laps.length).some((l) => ours.has(l.carId));
    out.push({ frame, ourLap, tags: changedOf(prev, cur) });
  }
  return out;
}

/** The frames after the first whose change is one of the job's triggers: a lap record of ours, a stop, the race's session phase, a decision. */
const triggerFrames = (spec: ScViewSpec = {}): FrameNumber[] =>
  framesOf(spec)
    .filter((x) => x.ourLap || x.tags.has('pitStops') || x.tags.has('spans:session-phase-race') || x.tags.has('decisions'))
    .map((x) => x.frame);

/** One feed's job wiring: the scheduler with the features' demand for `subscribed`, the trigger's inputs and the job results as they arrive. */
function feed(subscribed: TopicName[]) {
  const scCall = featureOf('sc-call');
  const upstream = ['race-hazard', 'rejoin', 'pit-loss', 'gaps'].map(featureOf);
  const results: JobResult[] = [];
  const waiting: Array<() => void> = [];
  const jobs = new FeedJobs([scCall], (r) => {
    results.push(r);
    waiting.splice(0).forEach((w) => w());
  });
  const registry = CalculatorRegistry.build([...upstream.flatMap((f) => f.calculators), ...scCall.calculators, ...jobs.calculators]);
  const scheduler = new Scheduler(registry);
  scheduler.setNeeded(demandOf([scCall, ...upstream], registry)(new Set(subscribed)));
  const triggered: FrameNumber[] = [];
  const inputs = new Map<number, ScCallInput>();
  /** One pass on `input`; a job whose trigger ran goes to the worker, computed for `frameId`. */
  const pass = (input: SchedulerInput, frameId: number): void => {
    const result = scheduler.run(input);
    expect(result.errors).toEqual([]);
    if (result.ran.includes(TRIGGER)) {
      triggered.push(frameId as FrameNumber);
      inputs.set(frameId, structuredClone(result.outputs.get(TRIGGER) as ScCallInput));
    }
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
  return { pass, triggered, inputs, results, resultFor, jobs };
}

const valueOf = (r: JobResult): Record<CarId, ScCall> => {
  expect(r).not.toHaveProperty('error');
  return (r as { value: Record<CarId, ScCall> }).value;
};

/** A trigger frame on the leader's lap `lap`. */
const triggerOnLap = (lap: number, spec: ScViewSpec = {}): FrameNumber => {
  const frames = new Set(RACE.framesOfLap(lap));
  const f = triggerFrames(spec).find((x) => frames.has(x));
  if (f === undefined) throw new Error(`no trigger frame on lap ${lap}`);
  return f;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((j) => j.close()));
});

describe('sc-call feature', () => {
  // row 6
  it('the same jobSeed gives a bit-identical output', async () => {
    const at = triggerOnLap(2);
    const live = feed([TOPIC]);
    for (let f = 1; f <= at; f++) live.pass(inputOf(f as FrameNumber), f);
    const liveOut = valueOf(await live.resultFor(at));
    for (const car of OURS) expect(liveOut[car]?.rows[0].ePosDelta.known, `car ${car}`).toBe(true);

    // in process, the trigger's input with the frame's seed: twice the same, and the worker's
    const input = live.inputs.get(at);
    expect(input).toBeDefined();
    // the job's module, as the worker loads it
    const { run: runScCall } = (await import(SC_CALL_JOB.module.href)) as { run: (input: ScCallInput, rng: ReturnType<typeof createRng>) => Record<CarId, ScCall> };
    const inProcess = () => runScCall(structuredClone(input!), createRng(jobSeed(0, SC_CALL_JOB.id, { lap: 0, frameId: at })));
    const once = inProcess();
    expect(inProcess()).toStrictEqual(once);
    expect(once).toEqual(liveOut);
  }, 120_000);

  // row 7
  it('a rewind cancels and re-triggers the job (C30)', async () => {
    const target = triggerOnLap(2);

    // the run that never received the frames after the target
    const clean = feed([TOPIC]);
    for (let f = 1; f <= target; f++) clean.pass(inputOf(f as FrameNumber), f);
    const expected = valueOf(await clean.resultFor(target));

    // the run that went on to the next trigger; the flashback to the target cancels it, the rewound frame re-triggers
    const rewound = feed([TOPIC]);
    const next = triggerFrames().find((f) => f > target)!;
    for (let f = 1; f <= next; f++) rewound.pass(inputOf(f as FrameNumber), f);
    expect(rewound.triggered.at(-1)).toBe(next);
    rewound.jobs.flashback();
    const since = rewound.results.length;
    const atTarget = RACE.viewAt(target).live.sessionTime;
    const delta = { before: projectionLengths(viewOf(next).history), after: projectionLengths(viewOf(target).history), rewound: { frameId: target, at: atTarget } };
    rewound.pass(inputOf(target, {}, delta), target);
    expect(rewound.triggered.at(-1)).toBe(target);
    const after = valueOf(await rewound.resultFor(target, since));
    expect(after).toEqual(expected);
    // the cancelled run never delivered
    expect(rewound.results.slice(since).map((r) => r.computedFor.frameId)).toEqual([target]);
  }, 120_000);

  // row 8
  it('notApplicable outside the race phase (both rows unknown, the car present); on demand only (C49)', async () => {
    const spec: ScViewSpec = { phase: 'qualifying' };
    const at = 1 as FrameNumber;
    const qualifying = feed([TOPIC]);
    qualifying.pass(inputOf(at, spec), at);
    expect(qualifying.triggered).toEqual([at]);
    const out = valueOf(await qualifying.resultFor(at));
    expect(Object.keys(out).sort()).toEqual(OURS.map(String).sort());
    for (const car of OURS) {
      const call = out[car]!;
      expect(call.carId).toBe(car);
      expect(call.rows.map((r) => r.condition)).toEqual(['sc', 'vsc']);
      for (const row of call.rows) expect(knownsOf(row), `car ${car} ${row.condition}`).toEqual(ALL_NOT_APPLICABLE);
    }

    // on demand: without a subscriber of scCall.car the trigger never runs and nothing is computed
    const idle = feed([]);
    for (let f = 1; f <= RACE.lastFrame; f++) idle.pass(inputOf(f as FrameNumber), f);
    expect(idle.triggered).toEqual([]);
    expect(idle.results).toEqual([]);
  }, 120_000);

  // row 13
  it('a mini-sector crossing without a line crossing does not trigger the job', async () => {
    expect(SC_CALL_JOB.trigger).toEqual(STRATEGY_TRIGGER);
    const frames = framesOf();
    const miniOnly = frames.filter((x) => x.tags.has('miniSectors') && !x.ourLap && !x.tags.has('pitStops') && !x.tags.has('spans:session-phase-race') && !x.tags.has('decisions'));
    expect(miniOnly.length, 'frames with a mini-sector crossing alone').toBeGreaterThan(10);

    const demanded = feed([TOPIC]);
    for (let f = 1; f <= RACE.lastFrame; f++) demanded.pass(inputOf(f as FrameNumber), f);
    // newly needed, the trigger runs at once on frame 1 (C49), then at each of strategy's trigger changes only
    expect(demanded.triggered).toEqual([1, ...triggerFrames()]);
    const triggered = new Set<number>(demanded.triggered);
    for (const x of miniOnly) expect(triggered.has(x.frame), `frame ${x.frame}: a mini-sector crossing alone`).toBe(false);
    valueOf(await demanded.resultFor(demanded.triggered.at(-1)!));
  }, 240_000);
});
