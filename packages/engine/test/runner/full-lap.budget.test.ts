// The runner's speed budget (R20, contract C2, C38): the four steps over the full-lap segment race-zandvoort-full-lap
// (fixtures/index.json: a 20-car race lap, 5 331 frames) stay under 0.2 ms per frame. The profile measured 0.43 ms per
// frame, flat over the machine, the state update and the recorders. The frames are assembled once (`SessionTracker`, as
// battle.segments.test.ts does); each pass applies all of them through a fresh `SessionRunner`. The best of the timed
// passes counts, so machine load (a parallel suite, a busy core) cannot flake it (docs/testing.md 6).
import { describe, expect, it } from 'vitest';
import { feedId } from '@pitwall/domain';
import { SessionRunner, SessionTracker, type Frame } from '../../src/index.ts';
import { segmentPackets } from '../../../../test-support/segments.ts';

const FULL_LAP = 'race-zandvoort-full-lap.pwrec.gz';
/** Timed passes after one warm pass; the best of them counts. */
const PASSES = 3;
const TARGET_MS_PER_FRAME = 0.2;

describe('runner budget', () => {
  it(`race-zandvoort-full-lap: the best of ${PASSES} warm passes applies a frame in under ${TARGET_MS_PER_FRAME} ms on average`, async () => {
    const tracker = new SessionTracker({ feedId: feedId(FULL_LAP) });
    const events = (await segmentPackets(FULL_LAP)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
    const all = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
    const first = all.find((f) => f.session !== undefined);
    if (first?.session === undefined) throw new Error(`${FULL_LAP}: no frame carried a session`);
    const frames: readonly Frame[] = all.slice(all.indexOf(first));
    expect(frames.length).toBeGreaterThan(5_000);

    /** One pass: a fresh runner applies every frame; its final frame number keeps the work observable. */
    const pass = (): number => {
      const runner = new SessionRunner({ feedId: feedId(FULL_LAP), sessionUid: first.sessionUid, session: first.session! });
      for (const f of frames) runner.apply(f);
      runner.finish();
      return runner.state.frameNumber;
    };
    const warm = pass();
    expect(warm).toBeGreaterThan(0);
    const times: number[] = [];
    for (let i = 0; i < PASSES; i++) {
      const start = performance.now();
      const frameNumber = pass();
      times.push(performance.now() - start);
      expect(frameNumber).toBe(warm);
    }
    const best = Math.min(...times);
    const perFrame = best / frames.length;
    console.info(`[runner budget] ${FULL_LAP}, ${frames.length} frames: ${times.map((t) => t.toFixed(0)).join(' ms, ')} ms (best ${perFrame.toFixed(3)} ms per frame, target ${TARGET_MS_PER_FRAME} ms)`);
    expect(perFrame).toBeLessThan(TARGET_MS_PER_FRAME);
  });
});
