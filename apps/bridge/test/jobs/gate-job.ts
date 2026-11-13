// Worker module of the worker-limit tests. `counters` is shared by every worker that gets it:
// slot 0 the workers running now, slot 1 the most that ran at once, slot 2 the workers that started,
// slot 3 the gate (a worker holds until it is non-zero), slot 4 the workers that got past the gate.
import type { Rng } from '@pitwall/engine';

export type GateInput = { tags: string[]; counters: SharedArrayBuffer };
export type GateOutput = { tag: string; rolls: number[] };

export const RUNNING = 0, MAX_RUNNING = 1, STARTED = 2, GATE = 3, PASSED = 4;
export const gateCounters = (): SharedArrayBuffer => new SharedArrayBuffer(5 * 4);

/** Fail-safe only: a gate nobody opens gives up after this. */
const GATE_GIVE_UP_MS = 10_000;
const POLL_MS = 20;

/** Holds at the gate once, then returns one output per tag. */
export function run(input: GateInput, rng: Rng): GateOutput[] {
  const c = new Int32Array(input.counters);
  Atomics.add(c, STARTED, 1);
  const running = Atomics.add(c, RUNNING, 1) + 1;
  for (let max = Atomics.load(c, MAX_RUNNING); max < running; max = Atomics.load(c, MAX_RUNNING)) {
    if (Atomics.compareExchange(c, MAX_RUNNING, max, running) === max) break;
  }
  // Short waits, so a terminated worker stops between them.
  for (let waited = 0; Atomics.load(c, GATE) === 0 && waited < GATE_GIVE_UP_MS; waited += POLL_MS) {
    Atomics.wait(c, GATE, 0, POLL_MS);
  }
  Atomics.add(c, PASSED, 1);
  Atomics.sub(c, RUNNING, 1);
  return input.tags.map((tag) => ({ tag, rolls: [rng.next(), rng.next()] }));
}
