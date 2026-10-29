// The lap jumps of spec 8.5 on the full TT Zandvoort recording (15 laps). Skipped when the recording is absent.
import { afterEach, expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { harness, until } from './harness.ts';

/** Fast-forwarding the whole recording takes about a minute alone and much longer while `pnpm check` runs every suite. */
const WHOLE_RECORDING_MS = 300_000;

const open: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of open.splice(0)) await stop(); });

describeWithFixture('ttZandvoort', 'ReplayController on the TT Zandvoort recording', (path) => {
  const start = () => { const h = harness(path); open.push(h.stop); h.controller.control({ kind: 'pause' }); return h; };
  const jump = async (h: ReturnType<typeof start>, lap: number, notBefore?: (lap: number) => boolean) => {
    h.controller.control({ kind: 'jumpToLap', lap });
    await until(() => { const p = h.controller.position(); return p !== undefined && p.playerLap >= lap && (notBefore?.(p.playerLap) ?? true); }, () => {}, 120_000);
  };

  it('jumpToLap 5 then jumpToLap 2 gives the same session.info and cars.overview as a fresh replay fast-forwarded to lap 2', async () => {
    const jumped = start();
    await jump(jumped, 5);
    expect(jumped.controller.position()!.playerLap).toBe(5);
    await jump(jumped, 2, (lap) => lap < 5);
    const fresh = start();
    await jump(fresh, 2);
    expect(jumped.controller.position()).toEqual(fresh.controller.position());
    expect(jumped.controller.position()!.playerLap).toBe(2);
    const info = fresh.read('session.info');
    const cars = fresh.read('cars.overview');
    expect(info).toBeDefined();
    expect(cars).toBeDefined();
    expect(jumped.read('session.info')).toEqual(info);
    expect(jumped.read('cars.overview')).toEqual(cars);
    expect(jumped.status()).toMatchObject({ paused: true, atEnd: false, playerLap: 2 });
    expect(jumped.gate.requested).toEqual([]);
  }, 180_000);

  it('jumpToLap 99 ends with note beyondEnd within the test timeout', async () => {
    const h = start();
    h.controller.control({ kind: 'jumpToLap', lap: 99 });
    await until(() => h.status()?.atEnd === true, () => {}, WHOLE_RECORDING_MS);
    expect(h.status()).toMatchObject({ atEnd: true, note: 'beyondEnd', paused: true });
    expect(h.status()!.playerLap).toBeGreaterThanOrEqual(15);
  }, WHOLE_RECORDING_MS + 30_000);
});
