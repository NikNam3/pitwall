import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRng, type Job } from '@pitwall/engine';
import { JobRunner, jobSeed, type JobResult } from '../../src/jobs/job-runner.ts';
import type { PartItem, PartOutput, PartsInput } from './parts-job.ts';

// A job run in parts (SP4.3b Q4 D, `Job.parts`): one part per item, merged in the parts' order.
const module = new URL('./parts-job.ts', import.meta.url);
const byItem = {
  split: (input: PartsInput): PartsInput[] => input.items.map((item) => ({ items: [item], counters: input.counters })),
  merge: (outs: PartOutput[][]): PartOutput[] => outs.flat(),
};
type Parts = NonNullable<Job<PartsInput, PartOutput[]>['parts']>;
const wholeJob = (): Job<PartsInput, PartOutput[]> => ({
  kind: 'job', id: 'split', reads: [], trigger: 'lapCompleted', prepare: () => { throw new Error('unused'); }, module,
});
const partsJob = (parts: Parts = byItem): Job<PartsInput, PartOutput[]> => ({ ...wholeJob(), parts });
const input = (items: PartItem[]) => {
  const counters = new SharedArrayBuffer(8);
  return { input: { items, counters }, finished: () => Atomics.load(new Int32Array(counters), 1) };
};
const at = { lap: 3, frameId: 100 };
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rolls = (seed: number) => { const rng = createRng(seed); return [rng.next(), rng.next()]; };

const runners: JobRunner[] = [];
const make = (seed: number) => { const r = new JobRunner({ seed }); runners.push(r); const got: JobResult[] = []; r.onResult((x) => got.push(x)); return { r, got }; };
afterEach(async () => { await Promise.all(runners.splice(0).map((r) => r.close())); });

describe('JobRunner: a job in parts', () => {
  it('a job with parts runs every part at once, one worker each, and delivers one result: merge of the parts\' outputs in the parts\' order', async () => {
    const { r, got } = make(7);
    // Each part waits at a barrier until all three reached it: only parts running at the same time, each in its own
    // worker, pass it. The first part finishes last, so the order comes from the parts, not from completion.
    const run = input([{ tag: 'a', barrier: 3, sleepMs: 150 }, { tag: 'b', barrier: 3, sleepMs: 50 }, { tag: 'c', barrier: 3 }]);
    r.trigger(partsJob(), run.input, at);
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 15_000 });
    await settle(300);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ jobId: 'split', computedFor: at });
    const value = (got[0] as { value: PartOutput[] }).value;
    expect(value.map((o) => o.tag)).toEqual(['a', 'b', 'c']);
    expect(value.map((o) => o.overlapped)).toEqual([true, true, true]);
  }, 20_000);

  it('part i is seeded with jobSeed(seed, "<id>/<i>", computedFor); a job without parts keeps jobSeed(seed, id, computedFor)', async () => {
    const parted = make(7), whole = make(7);
    parted.r.trigger(partsJob(), input([{ tag: 'a' }, { tag: 'b' }]).input, at);
    whole.r.trigger(wholeJob(), input([{ tag: 'w' }]).input, at);
    await vi.waitFor(() => expect([parted.got, whole.got].every((g) => g.length === 1)).toBe(true), { timeout: 8000 });
    expect(parted.got[0]).toEqual({
      jobId: 'split', computedFor: at,
      value: [
        { tag: 'a', overlapped: false, rolls: rolls(jobSeed(7, 'split/0', at)) },
        { tag: 'b', overlapped: false, rolls: rolls(jobSeed(7, 'split/1', at)) },
      ],
    });
    expect(whole.got[0]).toEqual({ jobId: 'split', computedFor: at, value: [{ tag: 'w', overlapped: false, rolls: rolls(jobSeed(7, 'split', at)) }] });
  });

  it('a newer trigger of the job terminates every running part of the older run; only the newest run delivers', async () => {
    const { r, got } = make(1);
    const older = input([{ tag: 'old0', sleepMs: 500 }, { tag: 'old1', sleepMs: 500 }]);
    r.trigger(partsJob(), older.input, { lap: 1, frameId: 1 });
    await settle(150); // the older parts are running
    r.trigger(partsJob(), input([{ tag: 'new0' }, { tag: 'new1' }]).input, { lap: 1, frameId: 2 });
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 8000 });
    await settle(800);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ computedFor: { lap: 1, frameId: 2 }, value: [{ tag: 'new0' }, { tag: 'new1' }] });
    expect(older.finished()).toBe(0);
  });

  it.each([
    ['throws', { tag: 'x', fail: true }, 'boom x'],
    ['crashes', { tag: 'x', crash: true }, undefined],
  ] as const)('a part that %s makes the run one error result and terminates the other parts', async (_, failing, message) => {
    const { r, got } = make(1);
    const run = input([{ tag: 'slow0', sleepMs: 800 }, failing, { tag: 'slow2', sleepMs: 800 }]);
    r.trigger(partsJob(), run.input, at);
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 8000 });
    await settle(1200);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ jobId: 'split', computedFor: at, error: message ?? expect.any(String) });
    expect(got[0]).not.toHaveProperty('value');
    expect(run.finished()).toBe(1); // only the failing part got past its sleep
  });

  it('cancel() and close() terminate every part; no late result', async () => {
    const { r, got } = make(1);
    const cancelled = input([{ tag: 'c0', sleepMs: 400 }, { tag: 'c1', sleepMs: 400 }]);
    r.trigger(partsJob(), cancelled.input, at);
    await settle(150);
    r.cancel();
    const closed = input([{ tag: 'k0', sleepMs: 400 }, { tag: 'k1', sleepMs: 400 }]);
    r.trigger(partsJob(), closed.input, { lap: 3, frameId: 101 });
    await settle(150);
    await r.close();
    await settle(700);
    expect(got).toEqual([]);
    expect(cancelled.finished()).toBe(0);
    expect(closed.finished()).toBe(0);
  });

  it.each([
    ['throws', { split: () => { throw new Error('bad split'); }, merge: byItem.merge }, 'bad split'],
    ['returns no part', { split: () => [], merge: byItem.merge }, undefined],
  ] as const)('a split that %s is one error result, never an exception', async (_, parts, message) => {
    const { r, got } = make(1);
    expect(() => r.trigger(partsJob(parts), input([{ tag: 'a' }]).input, at)).not.toThrow();
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 8000 });
    await settle(200);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ jobId: 'split', computedFor: at, error: message ?? expect.any(String) });
  });
});
