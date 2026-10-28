// Worker module of the job-in-feature tests: resolves to `base + rng.next()`, so the value shows which seed ran.
import type { Rng } from '@pitwall/engine';

export type AddRngInput = { base: number; sleepMs?: number; fail?: boolean };

export async function run(input: AddRngInput, rng: Rng): Promise<number> {
  if (input.sleepMs) await new Promise((resolve) => setTimeout(resolve, input.sleepMs));
  if (input.fail) throw new Error('boom from add-rng');
  return input.base + rng.next();
}
