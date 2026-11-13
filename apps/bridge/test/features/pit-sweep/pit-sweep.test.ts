// The `pit-sweep` feature (SP4.3b spec §9.2; plan 4.3b2 Task 8 rows 9, 10 and 12; C14, C30, C49, C51): its job is wired
// as the bridge wires every job (`FeedJobs`: the trigger calculator `job:pit-sweep`, run by the scheduler on demand,
// then in a worker seeded by `jobSeed`). Driven frame by frame over a short generator race seen from our two cars, with
// the change tags each frame sets, as `strategy`'s feature test does (`../strategy/strategy.test.ts`); the registry
// holds the calculators the job reads (`race-hazard`, `pit-window`, `rejoin`) and everything they read.
//  - row 9: a rewind cancels the run under way and the rewound frame re-triggers the job; the output equals the one of
//    a run that never received the undone frames (same seed: `jobSeed` of the frame);
//  - row 10: `notApplicable` for our cars outside the race phase and in the pit lane (the job in process on the views
//    of `packages/analysis/test/pit-sweep/support.ts`); the trigger runs only while `pitSweep.car` is subscribed;
//  - row 12: the trigger is `strategy`'s (each line crossing of ours, a stop, the race's session phase, a decision); a
//    mini-sector crossing without a line crossing does not run it.
import type { TopicName } from '@pitwall/contracts';
import { unknown, type FrameNumber } from '@pitwall/domain';
import { createRng, type EngineView } from '@pitwall/engine/readers';
import { CalculatorRegistry, projectionLengths, Scheduler, type SchedulerInput } from '@pitwall/engine';
import { PIT_SWEEP_JOB, STRATEGY_TRIGGER, type PitSweepOutput } from '@pitwall/analysis';
import { afterEach, describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/features/feature.ts';
import { FEATURES } from '../../../src/features/index.generated.ts';
import { FeedJobs, jobCalculatorId } from '../../../src/jobs/feed-jobs.ts';
import type { JobResult } from '../../../src/jobs/job-runner.ts';
import { demandOf } from '../../../src/pipeline/demand.ts';
import { NO_DRIVERS, NO_PRIORS } from '../../../../../test-support/builders/index.ts';
import { generated, OURS, PARAMS, PLAYER, TEAMMATE, viewAtFrame, type ViewSpec } from '../../../../../packages/analysis/test/strategy/support.ts';
import { SWEEP_CAP, sweepViewAt } from '../../../../../packages/analysis/test/pit-sweep/support.ts';
import { run } from '../../../../../packages/analysis/src/pit-sweep/job.ts';

const TOPIC: TopicName = 'pitSweep.car';
const TRIGGER = jobCalculatorId('pit-sweep');
/** Every feed's jobs, closed after each test. */
const open: FeedJobs[] = [];

/** A short race: the small generator field, 6 laps, one stop each on lap 3 or 4. */
const RACE = generated({ ...PARAMS, laps: 6, field: PARAMS.field.map((car, i) => ({ ...car, stops: [{ lap: 3 + (i % 2), compound: 'hard' as const }] })) });

function featureOf(name: string): Feature {
  const f = FEATURES.find((x) => x.name === name);
  if (f === undefined) throw new Error(`no ${name} feature in the generated feature index`);
  return f;
}

/** The calculators of every feature, by id. */
const ALL = new Map(FEATURES.flatMap((f) => f.calculators).map((c) => [c.id as string, c]));

/** The calculators the job reads and, transitively, what they read. */
function readClosure(): (typeof ALL extends Map<string, infer C> ? C : never)[] {
  const ids = new Set<string>();
  const visit = (id: string): void => {
    if (ids.has(id)) return;
    const calc = ALL.get(id);
    if (calc === undefined) throw new Error(`no feature registers the calculator ${id}`);
    ids.add(id);
    for (const r of calc.reads) if (typeof r === 'object' && 'calculator' in r) visit(r.calculator);
  };
  for (const r of PIT_SWEEP_JOB.reads) if (typeof r === 'object' && 'calculator' in r) visit(r.calculator);
  return [...ids].map((id) => ALL.get(id)!);
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

/** The view after `frame`, `pit-sweep`'s config at the tests' small cap. */
const viewOf = (frame: FrameNumber, spec: ViewSpec = {}): EngineView => {
  const v = viewAtFrame(RACE, frame, spec);
  return { ...v, config: { ...v.config, 'pit-sweep': { maxScenarioPolicies: SWEEP_CAP } } };
};

/** The scheduler's input after `frame`, its change tags from the frame before, its delta optionally replaced. */
function inputOf(frame: FrameNumber, spec: ViewSpec = {}, delta?: SchedulerInput['delta']): SchedulerInput {
  const cur = viewOf(frame, spec);
  const prev = frame > 1 ? viewOf(frame - 1, spec) : undefined;
  const { outputs: _outputs, priors: _priors, drivers: _drivers, ...view } = cur;
  return { ...view, priors: NO_PRIORS, drivers: NO_DRIVERS, changed: changedOf(prev, cur) as SchedulerInput['changed'], ...(delta && { delta }) };
}

/** Per frame after the first: whether one of the job's triggers changed, and whether only mini-sector crossings grew without a lap record of ours. */
function frameKinds(upTo: FrameNumber = RACE.lastFrame): { triggers: FrameNumber[]; crossingsOnly: FrameNumber[] } {
  const triggers: FrameNumber[] = [];
  const crossingsOnly: FrameNumber[] = [];
  const ours = new Set<number>(OURS);
  for (let f = 2; f <= upTo; f++) {
    const prev = viewOf(f - 1);
    const cur = viewOf(f);
    const tags = changedOf(prev, cur);
    const ourLap = cur.history.laps.slice(prev.history.laps.length).some((l) => ours.has(l.carId));
    if (ourLap || tags.has('pitStops') || tags.has('spans:session-phase-race') || tags.has('decisions')) triggers.push(f);
    else if (tags.has('miniSectors')) crossingsOnly.push(f);
  }
  return { triggers, crossingsOnly };
}
const KINDS = (() => {
  let k: ReturnType<typeof frameKinds> | undefined;
  return () => (k ??= frameKinds());
})();

/** One feed's job wiring: the scheduler with the features' demand for `subscribed`, and the job results as they arrive. */
function feed(subscribed: TopicName[]) {
  const sweep = featureOf('pit-sweep');
  const results: JobResult[] = [];
  const waiting: Array<() => void> = [];
  const jobs = new FeedJobs([sweep], (r) => {
    results.push(r);
    waiting.splice(0).forEach((w) => w());
  });
  const registry = CalculatorRegistry.build([...readClosure(), ...sweep.calculators, ...jobs.calculators]);
  const scheduler = new Scheduler(registry);
  scheduler.setNeeded(demandOf([sweep], registry)(new Set(subscribed)));
  const triggered: FrameNumber[] = [];
  const pass = (input: SchedulerInput, frameId: number): void => {
    const result = scheduler.run(input);
    expect(result.errors).toEqual([]);
    if (result.ran.includes(TRIGGER)) triggered.push(frameId);
    jobs.triggerRan(result, { lap: 0, frameId });
  };
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

const valueOf = (r: JobResult): PitSweepOutput => {
  expect(r).not.toHaveProperty('error');
  return (r as { value: PitSweepOutput }).value;
};

/** A trigger frame on the leader's lap `lap`. */
const triggerOnLap = (lap: number): FrameNumber => {
  const frames = new Set(RACE.framesOfLap(lap));
  const f = KINDS().triggers.find((x) => frames.has(x));
  if (f === undefined) throw new Error(`no trigger frame on lap ${lap}`);
  return f;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((j) => j.close()));
});

describe('pit-sweep feature', () => {
  // row 9
  it('a rewind cancels and re-triggers the job (C30)', async () => {
    const target = triggerOnLap(2);

    // the run that never received the frames after the target
    const clean = feed([TOPIC]);
    for (let f = 1; f <= target; f++) clean.pass(inputOf(f), f);
    const expected = valueOf(await clean.resultFor(target));
    for (const car of OURS) expect(Object.keys(expected[car]?.byCompound ?? {}).length, `car ${car}`).toBeGreaterThan(0);

    // the run that went on to a later trigger: a run under way
    const rewound = feed([TOPIC]);
    const next = KINDS().triggers.find((f) => f > target + 30)!;
    for (let f = 1; f <= next; f++) rewound.pass(inputOf(f), f);
    expect(rewound.triggered.at(-1)).toBe(next);
    // the flashback to the target cancels it, the rewound frame re-triggers
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

  // row 10
  it('notApplicable outside the race phase and in the pit lane (auto unknown, byCompound empty); on demand only (C49)', async () => {
    const NOT_APPLICABLE = unknown('notApplicable');
    const outOf = (view: EngineView) => run(structuredClone(PIT_SWEEP_JOB.prepare(view)), createRng(1));
    const lap = 3;
    // outside the race phase: every car of ours
    const qualifying = outOf(sweepViewAt(RACE, lap, { weekendPhase: 'qualifying' }));
    for (const car of OURS) expect(qualifying[car], `qualifying, car ${car}`).toMatchObject({ carId: car, auto: NOT_APPLICABLE, byCompound: {} });
    // our car in the pit lane (its box stop) or on its in-lap: that car only; the other is swept
    for (const kind of ['boxStop', 'inLap']) {
      const out = outOf(sweepViewAt(RACE, lap, { spans: [{ machine: 'car-activity-race', carId: PLAYER, kind }] }));
      expect(out[PLAYER], `${kind}, the player`).toMatchObject({ carId: PLAYER, auto: NOT_APPLICABLE, byCompound: {} });
      expect(Object.keys(out[TEAMMATE]?.byCompound ?? {}).length, `${kind}, the teammate`).toBeGreaterThan(0);
    }
    // under a neutralisation the sweep computes (a stop lap under it costs that condition's loss through the DP)
    const neutralised = outOf(sweepViewAt(RACE, lap, { spans: [{ machine: 'session-phase-race', kind: 'neutralised' }] }));
    for (const car of OURS) expect(Object.keys(neutralised[car]?.byCompound ?? {}).length, `neutralised, car ${car}`).toBeGreaterThan(0);

    // on demand: the trigger runs only while pitSweep.car is subscribed
    const upTo = triggerOnLap(2);
    const idle = feed([]);
    for (let f = 1; f <= upTo; f++) idle.pass(inputOf(f), f);
    expect(idle.triggered).toEqual([]);
    const demanded = feed([TOPIC]);
    for (let f = 1; f <= upTo; f++) demanded.pass(inputOf(f), f);
    // newly needed, it runs at once on frame 1 (C49)
    expect(demanded.triggered[0]).toBe(1);
    valueOf(await demanded.resultFor(demanded.triggered.at(-1)!));
    expect(idle.results).toEqual([]);
  }, 120_000);

  // row 12
  it('a mini-sector crossing without a line crossing does not trigger the job', async () => {
    expect(PIT_SWEEP_JOB.trigger).toEqual(STRATEGY_TRIGGER);
    const upTo = triggerOnLap(3);
    const { triggers, crossingsOnly } = frameKinds(upTo);
    expect(crossingsOnly.length, 'frames with mini-sector crossings only').toBeGreaterThan(10);
    const f = feed([TOPIC]);
    for (let k = 1; k <= upTo; k++) f.pass(inputOf(k), k);
    expect(f.triggered).toEqual([1, ...triggers]);
    for (const k of crossingsOnly) expect(f.triggered, `frame ${k}`).not.toContain(k);
    valueOf(await f.resultFor(upTo));
  }, 120_000);
});
