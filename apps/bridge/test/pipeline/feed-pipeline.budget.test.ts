// The replay pipeline's speed budget (SP4.3c Task 12s; user rule: fix slowness, never raise a timeout). A feed's whole
// pipeline (input, the engine's four steps, the scheduler with every shipped feature, publishing) over the segment
// race-zandvoort-lap10 (fixtures/index.json: 5 s of a 20-car race, 333 frames), replayed as fast as possible, as the
// replay controller's jumps run it (apps/bridge/test/replay/replay-controller.test.ts). The test runs set
// `PITWALL_FREEZE_OUTPUTS` (vitest.global-setup.ts), so every output is frozen deep as in every bridge test.
//
// Measured on the shared machine, best of 3 passes: 3.6–4.8 ms per frame at d817eea8 (`tyre-model`, Task 12, runs on every
// frame through its `onChange: ['tyres']` cadence: 332 runs, ~1.7 ms each plus the deep freeze of its output), against
// 1.3–1.6 ms per frame with `tyre-model` run at 4 Hz as `tyre-life` ran before Task 12 (20 runs; the pre-Task-12 speed
// of 89b7649c, where the replay-controller test took 0.7–0.9 s against 2.5–3.0 s since). The target is that speed with
// a margin for load. The best of the timed passes counts, so machine load cannot flake it (docs/testing.md 6).
import { feedId } from '@pitwall/domain';
import { SessionTracker } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { segmentPackets, segmentPath } from '../../../../test-support/segments.ts';

const SEGMENT = 'race-zandvoort-lap10.pwrec.gz';
const FEED = feedId('budget');
/** Timed passes after one warm pass; the best of them counts. */
const PASSES = 3;
/** The pre-Task-12 speed (1.3–1.6 ms per frame) with a margin for load; 3.6–4.8 ms per frame at d817eea8. */
const TARGET_MS_PER_FRAME = 2;

/** The segment's frames, as frame assembly splits them. */
async function frameCount(): Promise<number> {
  const tracker = new SessionTracker({ feedId: FEED });
  const events = (await segmentPackets(SEGMENT)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  return [...events, ...tracker.end()].filter((e) => e.type === 'frame').length;
}

/** One pass: a fresh pipeline replays the segment as fast as possible; its last position keeps the work observable. */
async function pass(): Promise<{ ms: number; sessionTimeMs: number | undefined }> {
  const source = new PwrecSource({ feedId: FEED, path: segmentPath(SEGMENT), mode: 'asFastAsPossible' });
  const pipeline = new FeedPipeline({ feedId: FEED, source, hub: new TopicHub({ now: () => 0 }), features: FEATURES, log: createLogger({ level: 'silent' }) });
  const start = performance.now();
  pipeline.start();
  await pipeline.done;
  const ms = performance.now() - start;
  return { ms, sessionTimeMs: pipeline.position()?.sessionTimeMs };
}

describe('replay pipeline budget', () => {
  it(`${SEGMENT}, every shipped feature: the best of ${PASSES} warm passes replays a frame in under ${TARGET_MS_PER_FRAME} ms on average`, async () => {
    expect(process.env.PITWALL_FREEZE_OUTPUTS).toBe('1');
    const frames = await frameCount();
    expect(frames).toBeGreaterThan(300);
    const warm = await pass();
    expect(warm.sessionTimeMs).toBeDefined();
    const times: number[] = [];
    for (let i = 0; i < PASSES; i++) {
      const { ms, sessionTimeMs } = await pass();
      times.push(ms);
      expect(sessionTimeMs).toBe(warm.sessionTimeMs);
    }
    const perFrame = Math.min(...times) / frames;
    console.info(`[replay pipeline budget] ${SEGMENT}, ${frames} frames: ${times.map((t) => t.toFixed(0)).join(' ms, ')} ms (best ${perFrame.toFixed(2)} ms per frame, target ${TARGET_MS_PER_FRAME} ms)`);
    expect(perFrame).toBeLessThan(TARGET_MS_PER_FRAME);
  }, 60_000);
});
