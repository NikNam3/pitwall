// The `forecast-score` feature (SP4.3a spec 7.1, plan Task 19 rows 8 and 9): its job is wired as the bridge wires every
// job (`FeedJobs`: the trigger calculator `job:forecast-score`, run by the scheduler on demand, C49, then in a worker,
// C51). Driven frame by frame over a short generator race:
//  - on demand: the trigger runs only while `forecastScore.report` is subscribed, then at every frame that appended a
//    leader's lap record (the `leaderLap` trigger), and the worker delivers a report;
//  - a rewind: the runs under way are cancelled, the rewound frame re-triggers the job (C30), and the report equals
//    the one of a run that never received the undone frames (C33 for the job's input; no state between runs, C31).
import type { TopicName } from '@pitwall/contracts';
import type { FrameNumber, ForecastScoreReport } from '@pitwall/domain';
import { CalculatorRegistry, projectionLengths, Scheduler, type SchedulerInput } from '@pitwall/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/features/feature.ts';
import { FEATURES } from '../../../src/features/index.generated.ts';
import { FeedJobs, jobCalculatorId } from '../../../src/jobs/feed-jobs.ts';
import type { JobResult } from '../../../src/jobs/job-runner.ts';
import { demandOf } from '../../../src/pipeline/demand.ts';
import { NO_DRIVERS, NO_PRIORS } from '../../../../../test-support/builders/index.ts';
import type { BuilderRace } from '../../../../../test-support/builders/long-race.ts';
import { generated, SMALL, viewOf } from '../../../../../packages/analysis/test/forecast-score/support.ts';

const TOPIC: TopicName = 'forecastScore.report';
const TRIGGER = jobCalculatorId('forecast-score');
/** Every feed's jobs, closed after each test. */
const open: FeedJobs[] = [];

/** The feature as the bridge collects it (C63). */
function feature(): Feature {
  const f = FEATURES.find((x) => x.name === 'forecast-score');
  if (f === undefined) throw new Error('no forecast-score feature in the generated feature index');
  return f;
}

/** A short race: the small generator field, 6 laps, no stops. */
const RACE: BuilderRace = generated({ ...SMALL, laps: 6, field: SMALL.field.map((car) => ({ ...car, stops: [] })) });

/** The scheduler's input after `frame` (the view with its append frames and track file), its delta optionally replaced. */
function inputOf(frame: FrameNumber, delta?: SchedulerInput['delta']): SchedulerInput {
  const { outputs: _outputs, priors: _priors, drivers: _drivers, ...view } = viewOf(RACE, frame);
  return { ...view, ...(delta && { delta }), priors: NO_PRIORS, drivers: NO_DRIVERS };
}

/** The frames whose new lap records include the leader's (`positionAtEnd` 1). */
function leaderLapFrames(): FrameNumber[] {
  const frames: FrameNumber[] = [];
  for (let f = 1; f <= RACE.lastFrame; f++) {
    const v = RACE.viewAt(f);
    if (v.history.laps.slice(v.delta.before.laps ?? 0, v.delta.after.laps ?? 0).some((l) => l.positionAtEnd === 1)) frames.push(f);
  }
  return frames;
}

/** One feed's job wiring: the scheduler with the feature's demand for `subscribed`, and the job results as they arrive. */
function feed(subscribed: TopicName[]) {
  const f = feature();
  const results: JobResult[] = [];
  const waiting: Array<(r: JobResult) => void> = [];
  const jobs = new FeedJobs([f], (r) => {
    results.push(r);
    waiting.splice(0).forEach((w) => w(r));
  });
  const registry = CalculatorRegistry.build([...f.calculators, ...jobs.calculators]);
  const scheduler = new Scheduler(registry);
  scheduler.setNeeded(demandOf([f], registry)(new Set(subscribed)));
  const triggered: FrameNumber[] = [];
  /** One pass on `input`; a job whose trigger ran goes to the worker, computed for `frameId`. */
  const pass = (input: SchedulerInput, frameId: number): void => {
    const result = scheduler.run(input);
    expect(result.errors).toEqual([]);
    if (result.ran.includes(TRIGGER)) triggered.push(frameId);
    jobs.triggerRan(result, { lap: 0, frameId });
  };
  /** The result computed for `frameId`, once it arrives. */
  const resultFor = (frameId: number): Promise<JobResult> =>
    new Promise((resolve) => {
      const found = results.find((r) => r.computedFor.frameId === frameId);
      if (found !== undefined) return resolve(found);
      const wait = (r: JobResult) => (r.computedFor.frameId === frameId ? resolve(r) : waiting.push(wait));
      waiting.push(wait);
    });
  open.push(jobs);
  return { pass, triggered, results, resultFor, jobs };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((j) => j.close()));
});

describe('forecast-score feature', () => {
  it('on demand: the job runs only while forecastScore.report is subscribed (C49)', async () => {
    const idle = feed([]);
    for (let f = 1; f <= RACE.lastFrame; f++) idle.pass(inputOf(f), f);
    expect(idle.triggered).toEqual([]);

    const demanded = feed([TOPIC]);
    for (let f = 1; f <= RACE.lastFrame; f++) demanded.pass(inputOf(f), f);
    const expected = leaderLapFrames();
    expect(expected.length).toBeGreaterThan(0);
    expect(demanded.triggered).toEqual(expected);
    const last = await demanded.resultFor(expected.at(-1)!);
    expect(last).not.toHaveProperty('error');
    expect((last as { value: ForecastScoreReport }).value.forecasts.length).toBeGreaterThan(0);
    // Only the newest run delivers: every earlier one was replaced while under way.
    expect(idle.results).toEqual([]);
  }, 60_000);

  it('a rewind cancels and re-triggers the job; the report then equals a run without the undone frames', async () => {
    const leaderFrames = leaderLapFrames();
    expect(leaderFrames.length).toBeGreaterThanOrEqual(4);
    const target = leaderFrames[1]!;
    const undone = leaderFrames[3]!;

    // The run that never received the undone frames.
    const clean = feed([TOPIC]);
    for (let f = 1; f <= target; f++) clean.pass(inputOf(f), f);
    const expected = await clean.resultFor(target);
    expect(expected).not.toHaveProperty('error');

    // The run that went on to `undone`, then rewound to `target`: the projection is the target's again, a void appeared.
    const rewound = feed([TOPIC]);
    for (let f = 1; f <= undone; f++) rewound.pass(inputOf(f), f);
    rewound.jobs.flashback();
    const at = RACE.viewAt(target).live.sessionTime;
    const delta = { before: projectionLengths(RACE.viewAt(undone).history), after: projectionLengths(RACE.viewAt(target).history), rewound: { frameId: target, at } };
    const afterRewind = undone + 1;
    rewound.pass(inputOf(target, delta), afterRewind);
    expect(rewound.triggered.at(-1)).toBe(afterRewind);
    const result = await rewound.resultFor(afterRewind);
    expect(result).not.toHaveProperty('error');
    expect((result as { value: unknown }).value).toEqual((expected as { value: unknown }).value);
    // Nothing triggered before the rewind reached the topic: every such run was cancelled or replaced.
    expect(rewound.results.map((r) => r.computedFor.frameId)).toEqual([afterRewind]);
  }, 60_000);
});
