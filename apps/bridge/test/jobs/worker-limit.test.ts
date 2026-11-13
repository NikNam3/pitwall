import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRng, type Job } from '@pitwall/engine';
import { JobRunner, jobSeed, type JobResult } from '../../src/jobs/job-runner.ts';
import { MAX_JOB_WORKERS, WorkerLimit } from '../../src/jobs/worker-limit.ts';
import { GATE, gateCounters, MAX_RUNNING, PASSED, STARTED, type GateInput, type GateOutput } from './gate-job.ts';

// SP4.3b2 Task 18b: one bridge-wide worker limit shared by every feed's runner (C1a, C51). Every worker runs
// `gate-job.ts`: it counts itself in shared memory and holds until the test opens its gate.
const module = new URL('./gate-job.ts', import.meta.url);
const gateJob = (id: string): Job<GateInput, GateOutput[]> => ({
  kind: 'job', id, reads: [], trigger: 'lapCompleted', prepare: () => { throw new Error('unused'); }, module,
});
const partsJob = (id: string): Job<GateInput, GateOutput[]> => ({
  ...gateJob(id),
  parts: { split: (input) => input.tags.map((tag) => ({ tags: [tag], counters: input.counters })), merge: (outs) => outs.flat() },
});

/** A group of workers sharing one set of counters and one gate. */
const group = (open = false) => {
  const counters = gateCounters();
  const c = new Int32Array(counters);
  if (open) Atomics.store(c, GATE, 1);
  return {
    input: (...tags: string[]): GateInput => ({ tags, counters }),
    started: () => Atomics.load(c, STARTED),
    passed: () => Atomics.load(c, PASSED),
    maxRunning: () => Atomics.load(c, MAX_RUNNING),
    open: () => { Atomics.store(c, GATE, 1); Atomics.notify(c, GATE); },
  };
};

const at = { lap: 3, frameId: 100 };
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rolls = (seed: number) => { const rng = createRng(seed); return [rng.next(), rng.next()]; };
const valueOf = (r: JobResult | undefined) => (r as { value: GateOutput[] } | undefined)?.value;

const runners: JobRunner[] = [];
const make = (seed: number, limit?: WorkerLimit) => {
  const r = new JobRunner(limit === undefined ? { seed } : { seed, limit });
  runners.push(r);
  const got: JobResult[] = [];
  r.onResult((x) => got.push(x));
  return { r, got };
};
afterEach(async () => { await Promise.all(runners.splice(0).map((r) => r.close())); });

describe('JobRunner: one worker limit across every feed (Task 18b)', () => {
  // row 1
  it('with 10 single-part jobs triggered at once, at most 8 workers run; the other 2 start as workers end; all 10 deliver', async () => {
    expect(MAX_JOB_WORKERS).toBe(8);
    const { r, got } = make(1, new WorkerLimit());
    const g = group();
    for (let i = 0; i < 10; i += 1) r.trigger(gateJob(`g${i}`), g.input(`t${i}`), at);
    await vi.waitFor(() => expect(g.started()).toBe(8), { timeout: 15_000 });
    await settle(400);
    expect(g.started(), 'the other 2 wait').toBe(8);
    expect(got).toEqual([]);
    g.open();
    await vi.waitFor(() => expect(got).toHaveLength(10), { timeout: 15_000 });
    expect(g.started()).toBe(10);
    expect(g.maxRunning()).toBeLessThanOrEqual(8);
    expect(got.map((x) => x.jobId).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `g${i}`).sort());
    expect(got.every((x) => 'value' in x)).toBe(true);
  }, 30_000);

  // row 2
  it('the limit is shared by two feeds\' runners', async () => {
    const limit = new WorkerLimit();
    const a = make(1, limit), b = make(1, limit);
    const g = group();
    for (let i = 0; i < 6; i += 1) a.r.trigger(gateJob(`a${i}`), g.input(`a${i}`), at);
    for (let i = 0; i < 6; i += 1) b.r.trigger(gateJob(`b${i}`), g.input(`b${i}`), at);
    await vi.waitFor(() => expect(g.started()).toBe(8), { timeout: 15_000 });
    await settle(400);
    expect(g.started(), '12 jobs over two runners, 8 run').toBe(8);
    g.open();
    await vi.waitFor(() => expect(a.got.length + b.got.length).toBe(12), { timeout: 15_000 });
    expect(g.maxRunning()).toBeLessThanOrEqual(8);
    expect(a.got).toHaveLength(6);
    expect(b.got).toHaveLength(6);
  }, 30_000);

  // row 3
  it('a newer trigger of a job removes its waiting parts and terminates its running ones; only the newest run delivers', async () => {
    const { r, got } = make(1, new WorkerLimit());
    const blockers = group();
    for (let i = 0; i < 7; i += 1) r.trigger(gateJob(`b${i}`), blockers.input(`b${i}`), at);
    await vi.waitFor(() => expect(blockers.started()).toBe(7), { timeout: 15_000 });
    // 7 + 1 workers run: one part of the older run runs, two wait.
    const older = group();
    r.trigger(partsJob('p'), older.input('o0', 'o1', 'o2'), { lap: 1, frameId: 1 });
    await vi.waitFor(() => expect(older.started()).toBe(1), { timeout: 15_000 });
    await settle(300);
    expect(older.started()).toBe(1);
    const newer = group(true);
    r.trigger(partsJob('p'), newer.input('n0', 'n1', 'n2'), { lap: 1, frameId: 2 });
    await vi.waitFor(() => expect(got.filter((x) => x.jobId === 'p')).toHaveLength(1), { timeout: 15_000 });
    older.open(); // a part of the older run still alive would now finish
    await settle(500);
    const p = got.filter((x) => x.jobId === 'p');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ computedFor: { lap: 1, frameId: 2 } });
    expect(valueOf(p[0])?.map((o) => o.tag)).toEqual(['n0', 'n1', 'n2']);
    expect(older.started(), 'the waiting parts never started').toBe(1);
    expect(older.passed(), 'the running part was terminated').toBe(0);
    blockers.open();
    await vi.waitFor(() => expect(got).toHaveLength(8), { timeout: 15_000 });
  }, 40_000);

  // row 4
  it('a waiting part\'s result equals the result it gives without the limit (same seed)', async () => {
    const limit = new WorkerLimit();
    const blocking = make(5, limit);
    const blockers = group();
    for (let i = 0; i < 8; i += 1) blocking.r.trigger(gateJob(`b${i}`), blockers.input(`b${i}`), at);
    await vi.waitFor(() => expect(blockers.started()).toBe(8), { timeout: 15_000 });
    const limited = make(5, limit), free = make(5);
    const waiting = group(true), unlimited = group(true);
    limited.r.trigger(partsJob('s'), waiting.input('x', 'y'), at);
    limited.r.trigger(gateJob('w'), waiting.input('z'), at);
    free.r.trigger(partsJob('s'), unlimited.input('x', 'y'), at);
    free.r.trigger(gateJob('w'), unlimited.input('z'), at);
    await vi.waitFor(() => expect(free.got).toHaveLength(2), { timeout: 15_000 });
    await settle(300);
    expect(waiting.started(), 'the limited parts wait').toBe(0);
    blockers.open();
    await vi.waitFor(() => expect(limited.got).toHaveLength(2), { timeout: 15_000 });
    const byId = (gs: JobResult[]) => Object.fromEntries(gs.map((x) => [x.jobId, x]));
    expect(byId(limited.got)).toEqual(byId(free.got));
    expect(byId(limited.got)['s']).toEqual({
      jobId: 's', computedFor: at,
      value: [{ tag: 'x', rolls: rolls(jobSeed(5, 's/0', at)) }, { tag: 'y', rolls: rolls(jobSeed(5, 's/1', at)) }],
    });
    expect(byId(limited.got)['w']).toEqual({ jobId: 'w', computedFor: at, value: [{ tag: 'z', rolls: rolls(jobSeed(5, 'w', at)) }] });
  }, 30_000);

  // row 5
  it('close() drops waiting entries and suppresses late results', async () => {
    const limit = new WorkerLimit();
    const blocking = make(1, limit), closing = make(1, limit), after = make(1, limit);
    const blockers = group();
    for (let i = 0; i < 7; i += 1) blocking.r.trigger(gateJob(`b${i}`), blockers.input(`b${i}`), at);
    await vi.waitFor(() => expect(blockers.started()).toBe(7), { timeout: 15_000 });
    const closed = group();
    for (let i = 0; i < 3; i += 1) closing.r.trigger(gateJob(`c${i}`), closed.input(`c${i}`), at); // 1 runs, 2 wait
    await vi.waitFor(() => expect(closed.started()).toBe(1), { timeout: 15_000 });
    const later = group(true);
    for (let i = 0; i < 2; i += 1) after.r.trigger(gateJob(`l${i}`), later.input(`l${i}`), at); // wait behind them
    await settle(300);
    expect(later.started()).toBe(0);
    await closing.r.close();
    closed.open();
    // The closed runner's running worker is gone and its waiting ones never start: the freed slot goes to `after`.
    await vi.waitFor(() => expect(after.got).toHaveLength(2), { timeout: 15_000 });
    blockers.open();
    await vi.waitFor(() => expect(blocking.got).toHaveLength(7), { timeout: 15_000 });
    await settle(400);
    expect(closing.got).toEqual([]);
    expect(closed.started(), 'the waiting entries were dropped').toBe(1);
    expect(closed.passed()).toBe(0);
  }, 40_000);
});
