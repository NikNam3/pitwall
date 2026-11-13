// Worker module of the job-in-parts tests. Runs its items in order and returns one output per item.
// `counters` is shared by every worker of a run: slot 0 counts the items that reached the barrier, slot 1 the items
// that finished their sleep (a terminated worker never adds to it).
import type { Rng } from '@pitwall/engine';

export type PartItem = {
  tag: string;
  /** Wait until this many items (across all workers) reached the barrier; `overlapped` says whether they did. */
  barrier?: number;
  sleepMs?: number;
  fail?: boolean;
  /** Ends the worker thread without a result. */
  crash?: boolean;
};
export type PartsInput = { items: PartItem[]; counters: SharedArrayBuffer };
export type PartOutput = { tag: string; overlapped: boolean; rolls: number[] };

/** Fail-safe only: a barrier nobody else reaches gives up after this and reports `overlapped: false`. */
const BARRIER_GIVE_UP_MS = 2000;

function awaitBarrier(counters: Int32Array, barrier: number): boolean {
  Atomics.add(counters, 0, 1);
  Atomics.notify(counters, 0);
  for (let seen = Atomics.load(counters, 0); seen < barrier; seen = Atomics.load(counters, 0)) {
    if (Atomics.wait(counters, 0, seen, BARRIER_GIVE_UP_MS) === 'timed-out') return false;
  }
  return true;
}

export async function run(input: PartsInput, rng: Rng): Promise<PartOutput[]> {
  const counters = new Int32Array(input.counters);
  const outs: PartOutput[] = [];
  for (const item of input.items) {
    const overlapped = item.barrier === undefined ? false : awaitBarrier(counters, item.barrier);
    if (item.sleepMs) await new Promise((resolve) => setTimeout(resolve, item.sleepMs));
    Atomics.add(counters, 1, 1);
    if (item.crash) process.exit(3);
    if (item.fail) throw new Error(`boom ${item.tag}`);
    outs.push({ tag: item.tag, overlapped, rolls: [rng.next(), rng.next()] });
  }
  return outs;
}
