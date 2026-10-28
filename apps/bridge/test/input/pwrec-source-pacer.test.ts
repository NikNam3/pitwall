// PwrecSource `pacer` option (Task 5, requirement 1): the controller owns pacing; `mode` maps onto a fixed pacer.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { PwrecWriter } from '../../src/pwrec/writer.ts';
import { META } from '../pwrec/helpers.ts';

const FEED = 'feed-a' as FeedId;
async function recording(ts: number[]): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), 'src-pacer-')), 'r.pwrec.gz');
  const w = PwrecWriter.create(path, META);
  ts.forEach((t, i) => w.write(t, new Uint8Array([i])));
  await w.close((ts.at(-1) ?? 0) + 1);
  return path;
}
type Pacer = { wait(recordGapMs: number, signal: AbortSignal): Promise<void> };
const options = (path: string, pacer: Pacer) => ({ feedId: FEED, path, pacer }) as unknown as ConstructorParameters<typeof PwrecSource>[0];

describe('PwrecSource with a pacer', () => {
  it('asks the pacer for the recorded gap before each record after the first, and delivers in order', async () => {
    const gaps: number[] = [];
    const pacer: Pacer = { wait: async (gap) => { gaps.push(gap); } };
    const src = new PwrecSource(options(await recording([100, 110, 110, 150]), pacer));
    const got: Array<[number, number]> = [];
    src.start((p) => got.push([p.receivedAtMs, p.bytes[0]!]));
    await src.done;
    expect(got).toEqual([[100, 0], [110, 1], [110, 2], [150, 3]]);
    expect(gaps.every((g) => g >= 0)).toBe(true);
    expect(gaps.reduce((a, b) => a + b, 0)).toBe(50);
    expect(gaps.filter((g) => g > 0)).toEqual([10, 40]);
  });
  it('does not deliver the next record until the pacer resolves (a blocking pacer pauses the source)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const pacer: Pacer = { wait: async (gap) => { if (gap > 0) await gate; } };
    const src = new PwrecSource(options(await recording([0, 10, 20]), pacer));
    const got: number[] = [];
    src.start((p) => got.push(p.receivedAtMs));
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual([0]);
    release();
    await src.done;
    expect(got).toEqual([0, 10, 20]);
  });
  it('passes an AbortSignal that aborts on stop(), so a blocked pacer ends and done resolves without delivering more', async () => {
    let seen: AbortSignal | undefined;
    const pacer: Pacer = { wait: (_gap, signal) => { seen = signal; return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })); } };
    const src = new PwrecSource(options(await recording([0, 10, 20]), pacer));
    const got: number[] = [];
    src.start((p) => got.push(p.receivedAtMs));
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen!.aborted).toBe(false);
    await src.stop();
    expect(seen!.aborted).toBe(true);
    await src.done;
    expect(got).toEqual([0]);
  });
  it('keeps the existing mode option working: asFastAsPossible still never sleeps', async () => {
    const sleep = vi.fn();
    const src = new PwrecSource({ feedId: FEED, path: await recording([0, 10, 20]), mode: 'asFastAsPossible', sleep });
    src.start(() => {});
    await src.done;
    expect(sleep).not.toHaveBeenCalled();
  });
});
