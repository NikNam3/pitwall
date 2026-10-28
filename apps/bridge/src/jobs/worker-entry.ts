import { parentPort, workerData } from 'node:worker_threads';
import { createRng } from '@pitwall/engine';
import type { WorkerMessage } from './job-runner.ts';

type WorkerInput = { moduleHref: string; input: unknown; seed: number };

/** Worker thread body: runs `run(input, rng)` of the job module once and reports the outcome to the parent. */
async function execute({ moduleHref, input, seed }: WorkerInput): Promise<WorkerMessage> {
  try {
    const module = await import(moduleHref);
    return { ok: true, value: await module.run(input, createRng(seed)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

if (parentPort === null) throw new Error('worker-entry must run as a worker thread');
parentPort.postMessage(await execute(workerData as WorkerInput));
