// The `undercut` feature (SP4.3b spec §9.1; plan 4.3b2 Task 7 rows 8, 9, 10 and 13; C14, C30, C49, C51): its job is
// wired as the bridge wires every job (`FeedJobs`: the trigger calculator `job:undercut`, run by the scheduler on
// demand, then in a worker seeded by `jobSeed`). Driven frame by frame over a short generator race seen from our two
// cars, with the change tags each frame sets; the scheduler runs `rejoin` and `race-hazard` (and what they read) as
// the bridge does. The job's trigger is `strategy`'s (spec §9): a lap record of one of our cars, a stop, a change of
// the race's session phase or a decision.
import type { TopicName } from '@pitwall/contracts';
import { unknown, type FrameNumber } from '@pitwall/domain';
import { createRng, type Calculator, type EngineView } from '@pitwall/engine/readers';
import { CalculatorRegistry, projectionLengths, Scheduler, type SchedulerInput } from '@pitwall/engine';
import { UNDERCUT_JOB, type UndercutInput, type UndercutOutput } from '@pitwall/analysis';
import { afterEach, describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/features/feature.ts';
import { FEATURES } from '../../../src/features/index.generated.ts';
import { FeedJobs, jobCalculatorId } from '../../../src/jobs/feed-jobs.ts';
import { jobSeed, type JobResult } from '../../../src/jobs/job-runner.ts';
import { demandOf } from '../../../src/pipeline/demand.ts';
import { NO_DRIVERS, NO_PRIORS } from '../../../../../test-support/builders/index.ts';
import { generated, OURS, PARAMS, PLAYER, TEAMMATE, viewAtFrame, type ViewSpec } from '../../../../../packages/analysis/test/strategy/support.ts';
import { undercutView } from '../../../../../packages/analysis/test/undercut/support.ts';
import { run } from '../../../../../packages/analysis/src/undercut/job.ts';

const TOPIC: TopicName = 'undercut.car';
const TRIGGER = jobCalculatorId('undercut');
/** Every feed's jobs, closed after each test. */
const open: FeedJobs[] = [];

/** A short race: the small generator field, 6 laps, one stop each on lap 3 or 4. */
const RACE = generated({ ...PARAMS, laps: 6, field: PARAMS.field.map((car, i) => ({ ...car, stops: [{ lap: 3 + (i % 2), compound: 'hard' as const }] })) });

function featureOf(name: string): Feature {
  const f = FEATURES.find((x) => x.name === name);
  if (f === undefined) throw new Error(`no ${name} feature in the generated feature index`);
  return f;
}

/** The features' calculators the job reads, with everything they read in turn. */
function calculatorsFor(reads: readonly unknown[]): Calculator[] {
  const byId = new Map<string, Calculator>(FEATURES.flatMap((f) => f.calculators.map((c) => [c.id, c] as const)));
  const need = new Map<string, Calculator>();
  const stack = reads.flatMap((r) => (typeof r === 'object' && r !== null && 'calculator' in r ? [String(r.calculator)] : []));
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (need.has(id)) continue;
    const calc = byId.get(id);
    if (calc === undefined) throw new Error(`no feature registers the calculator ${id}`);
    need.set(id, calc);
    for (const r of calc.reads) if (typeof r === 'object' && 'calculator' in r) stack.push(r.calculator);
  }
  return [...need.values()];
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

const viewOf = (frame: FrameNumber, spec: ViewSpec = {}): EngineView => viewAtFrame(RACE, frame, spec);

/** The scheduler's input after `frame`, its change tags from the frame before, its delta optionally replaced. */
function inputOf(frame: FrameNumber, spec: ViewSpec = {}, delta?: SchedulerInput['delta']): SchedulerInput {
  const cur = viewOf(frame, spec);
  const prev = frame > 1 ? viewOf(frame - 1, spec) : undefined;
  const { outputs: _outputs, priors: _priors, drivers: _drivers, ...view } = cur;
  return { ...view, priors: NO_PRIORS, drivers: NO_DRIVERS, changed: changedOf(prev, cur) as SchedulerInput['changed'], ...(delta && { delta }) };
}

/** Per frame after the first: whether a lap record of ours was appended, and the frame's change tags. */
function framesWith(upTo: FrameNumber = RACE.lastFrame): { frame: FrameNumber; ourLap: boolean; tags: Set<string> }[] {
  const out: { frame: FrameNumber; ourLap: boolean; tags: Set<string> }[] = [];
  const ours = new Set<number>(OURS);
  for (let f = 2; f <= upTo; f++) {
    const prev = viewOf(f - 1);
    const cur = viewOf(f);
    out.push({ frame: f, ourLap: cur.history.laps.slice(prev.history.laps.length).some((l) => ours.has(l.carId)), tags: changedOf(prev, cur) });
  }
  return out;
}

const FRAMES = (() => {
  let v: ReturnType<typeof framesWith> | undefined;
  return () => (v ??= framesWith());
})();

/** The frames after the first whose change is one of the job's triggers. */
const triggerFrames = (): FrameNumber[] =>
  FRAMES()
    .filter((x) => x.ourLap || x.tags.has('pitStops') || x.tags.has('spans:session-phase-race') || x.tags.has('decisions'))
    .map((x) => x.frame);

/** One feed's job wiring: the scheduler with the feature's demand for `subscribed`, and the job results as they arrive. */
function feed(subscribed: TopicName[]) {
  const undercut = featureOf('undercut');
  const results: JobResult[] = [];
  const waiting: Array<() => void> = [];
  const jobs = new FeedJobs([undercut], (r) => {
    results.push(r);
    waiting.splice(0).forEach((w) => w());
  });
  const registry = CalculatorRegistry.build([...calculatorsFor(UNDERCUT_JOB.reads), ...undercut.calculators, ...jobs.calculators]);
  const scheduler = new Scheduler(registry);
  scheduler.setNeeded(demandOf([undercut], registry)(new Set(subscribed)));
  const triggered: FrameNumber[] = [];
  /** The job's input the trigger prepared, per frame it ran on. */
  const prepared = new Map<number, unknown>();
  const pass = (input: SchedulerInput, frameId: number): void => {
    const result = scheduler.run(input);
    expect(result.errors).toEqual([]);
    if (result.ran.includes(TRIGGER)) {
      triggered.push(frameId);
      prepared.set(frameId, result.outputs.get(TRIGGER));
    }
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
  return { pass, triggered, prepared, results, resultFor, jobs };
}

const valueOf = (r: JobResult): UndercutOutput => {
  expect(r).not.toHaveProperty('error');
  return (r as { value: UndercutOutput }).value;
};

/** A trigger frame on the leader's lap `lap`. */
const triggerOnLap = (lap: number): FrameNumber => {
  const frames = new Set(RACE.framesOfLap(lap));
  const f = triggerFrames().find((x) => frames.has(x));
  if (f === undefined) throw new Error(`no trigger frame on lap ${lap}`);
  return f;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((j) => j.close()));
});

describe('undercut feature', () => {
  // row 8
  it('the same jobSeed gives a bit-identical output', async () => {
    const at = triggerOnLap(3);
    const live = feed([TOPIC]);
    for (let f = 1; f <= at; f++) live.pass(inputOf(f), f);
    const liveOut = valueOf(await live.resultFor(at));
    for (const car of OURS) expect(liveOut[car], `car ${car}`).toBeDefined();

    // in process on the input the trigger prepared, with the frame's seed: twice bit-identical, and the worker's output
    const input = live.prepared.get(at) as UndercutInput;
    expect(input).toBeDefined();
    const seeded = () => run(structuredClone(input), createRng(jobSeed(0, UNDERCUT_JOB.id, { lap: 0, frameId: at })));
    const once = seeded();
    expect(seeded()).toStrictEqual(once);
    expect(once).toEqual(liveOut);
  }, 120_000);

  // row 9
  it('a rewind cancels and re-triggers the job (C30)', async () => {
    const target = triggerOnLap(3);

    // the run that never received the frames after the target
    const clean = feed([TOPIC]);
    for (let f = 1; f <= target; f++) clean.pass(inputOf(f), f);
    const expected = valueOf(await clean.resultFor(target));

    // the run that went on: one more trigger starts a run; the flashback to the target cancels it, the rewound frame re-triggers
    const rewound = feed([TOPIC]);
    const next = triggerFrames().find((f) => f > target + 10)!;
    for (let f = 1; f <= next; f++) rewound.pass(inputOf(f), f);
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

  // row 10
  it('notApplicable (unknown, never absent) outside the race phase, under a neutralised span and with our car in boxStop or inLap; on demand only (C49)', async () => {
    const NOT_APPLICABLE = unknown('notApplicable');
    const outOf = (view: EngineView): UndercutOutput => run(structuredClone(UNDERCUT_JOB.prepare(view)), createRng(3));

    // the race, racing: both cars computed
    const racing = outOf(undercutView());
    for (const car of OURS) expect(racing[car]?.known, `car ${car}`).toBe(true);

    for (const weekendPhase of ['practice', 'qualifying', 'none'] as const) {
      const out = outOf(undercutView(3, { weekendPhase }));
      expect(Object.keys(out).map(Number).sort(), weekendPhase).toEqual([...OURS].sort());
      for (const car of OURS) expect(out[car], `${weekendPhase} car ${car}`).toEqual(NOT_APPLICABLE);
    }
    const neutralised = outOf(undercutView(3, { sessionPhase: 'neutralised' }));
    for (const car of OURS) expect(neutralised[car], `neutralised car ${car}`).toEqual(NOT_APPLICABLE);
    for (const kind of ['boxStop', 'inLap']) {
      const out = outOf(undercutView(3, { activity: { car: PLAYER, kind } }));
      expect(out[PLAYER], kind).toEqual(NOT_APPLICABLE);
      // the other car still computes
      expect(out[TEAMMATE]?.known, `${kind}: teammate`).toBe(true);
    }

    // on demand: the trigger runs only while undercut.car is subscribed
    const idle = feed([]);
    for (let f = 1; f <= RACE.lastFrame; f++) idle.pass(inputOf(f), f);
    expect(idle.triggered).toEqual([]);
    const demanded = feed([TOPIC]);
    const last = triggerOnLap(3);
    for (let f = 1; f <= last; f++) demanded.pass(inputOf(f), f);
    expect(demanded.triggered[0]).toBe(1);
    valueOf(await demanded.resultFor(last));
    expect(idle.results).toEqual([]);
  }, 120_000);

  // row 13
  it('a mini-sector crossing without a line crossing does not trigger the job', async () => {
    const demanded = feed([TOPIC]);
    for (let f = 1; f <= RACE.lastFrame; f++) demanded.pass(inputOf(f), f);
    // newly needed, the trigger runs at once on frame 1 (C49), then at each of strategy's trigger changes
    expect(demanded.triggered).toEqual([1, ...triggerFrames()]);
    const crossingsOnly = FRAMES().filter((x) => x.tags.has('miniSectors') && !x.ourLap && !x.tags.has('pitStops') && !x.tags.has('spans:session-phase-race') && !x.tags.has('decisions'));
    expect(crossingsOnly.length).toBeGreaterThan(10);
    const fired = new Set(demanded.triggered);
    expect(crossingsOnly.filter((x) => fired.has(x.frame)).map((x) => x.frame)).toEqual([]);
    valueOf(await demanded.resultFor(demanded.triggered.at(-1)!));
  }, 120_000);
});
