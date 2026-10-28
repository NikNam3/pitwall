// Worker module used only by the job runner tests.
import type { Rng } from '@pitwall/engine';

export async function run(input: { tag: string; sleepMs: number; fail?: boolean }, rng: Rng) {
  await new Promise((r) => setTimeout(r, input.sleepMs));
  if (input.fail) throw new Error(`boom ${input.tag}`);
  return { tag: input.tag, rolls: [rng.next(), rng.next(), rng.next()] };
}
