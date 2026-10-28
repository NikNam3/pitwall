import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRng, type Job } from '@pitwall/engine';
import { JobRunner, jobSeed, type JobResult } from '../../src/jobs/job-runner.ts';

type In = { tag: string; sleepMs: number; fail?: boolean };
const job = (input: In): Job<In, unknown> => ({ kind: 'job', id: 'echo', reads: [], trigger: 'lapCompleted', prepare: () => input, module: new URL('./echo-job.ts', import.meta.url) });
const at = { lap: 3, frameId: 100 };
/** The pipeline runs `prepare` (as the calculator `job:<id>`) and hands the runner its output. */
const fire = (r: JobRunner, input: In, computedFor: { lap: number; frameId: number }) => r.trigger(job(input), input, computedFor);
const runners: JobRunner[] = [];
const make = (seed: number) => { const r = new JobRunner({ seed }); runners.push(r); const got: JobResult[] = []; r.onResult((x) => got.push(x)); return { r, got }; };
afterEach(async () => { await Promise.all(runners.splice(0).map((r) => r.close())); });

describe('JobRunner', () => {
  it('jobSeed is FNV-1a over "seed:id:lap:frameId"', () => {
    expect(jobSeed(7, 'j', { lap: 3, frameId: 100 })).toBe(1521242744);
  });
  it('delivers the value computed in a worker with the seeded rng', async () => {
    const { r, got } = make(7);
    fire(r, { tag: 'a', sleepMs: 1 }, at);
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 5000 });
    const rng = createRng(jobSeed(7, 'echo', at));
    expect(got[0]).toEqual({ jobId: 'echo', computedFor: at, value: { tag: 'a', rolls: [rng.next(), rng.next(), rng.next()] } });
  });
  it('same seed and trigger give the same result; another seed differs', async () => {
    const a = make(7), b = make(7), c = make(8);
    for (const x of [a, b, c]) fire(x.r, { tag: 'd', sleepMs: 1 }, at);
    await vi.waitFor(() => expect([a.got, b.got, c.got].every((g) => g.length === 1)).toBe(true), { timeout: 5000 });
    expect(a.got[0]).toEqual(b.got[0]);
    expect(a.got[0]).not.toEqual(c.got[0]);
  });
  it('a newer trigger terminates the running worker; only the newer result arrives', async () => {
    const { r, got } = make(1);
    fire(r, { tag: 'first', sleepMs: 400 }, { lap: 1, frameId: 1 });
    fire(r, { tag: 'second', sleepMs: 1 }, { lap: 1, frameId: 2 });
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 5000 });
    await new Promise((res) => setTimeout(res, 600));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ computedFor: { lap: 1, frameId: 2 }, value: { tag: 'second' } });
  });
  it('trigger takes the prepared input and does not call prepare itself', async () => {
    const { r, got } = make(1);
    const input = { tag: 'given', sleepMs: 1 };
    r.trigger({ ...job(input), prepare: () => { throw new Error('prepare must not run in the runner'); } }, input, at);
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 5000 });
    expect(got[0]).toMatchObject({ jobId: 'echo', computedFor: at, value: { tag: 'given' } });
  });
  it('a throwing job yields an error result', async () => {
    const { r, got } = make(1);
    fire(r, { tag: 'x', sleepMs: 1, fail: true }, at);
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 5000 });
    expect(got[0]).toEqual({ jobId: 'echo', computedFor: at, error: 'boom x' });
  });
  it('close() terminates running workers quickly and suppresses their results', async () => {
    const { r, got } = make(1);
    fire(r, { tag: 'slow', sleepMs: 5000 }, at);
    const t0 = Date.now();
    await r.close();
    expect(Date.now() - t0).toBeLessThan(1000);
    await new Promise((res) => setTimeout(res, 200));
    expect(got).toEqual([]);
    expect(() => fire(r, { tag: 'late', sleepMs: 1 }, at)).toThrow('JobRunner closed');
  });
});
