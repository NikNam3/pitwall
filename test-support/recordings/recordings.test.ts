// Task 0c: a synthetic qualifying with race samples reads back as the next session's forecast.
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { feedId } from '../../packages/domain/src/index.ts';
import { SessionRunner, SessionTracker, type Frame } from '../../packages/engine/src/index.ts';
import { syntheticPackets, writeSynthetic, type SyntheticSession } from './index.ts';

const QUALIFYING: SyntheticSession = {
  sessionUid: 7n,
  weekendId: 11,
  trackId: 15,
  kind: 'qualifying',
  player: 19,
  cars: Array.from({ length: 20 }, (_, i) => (i === 18 ? { teamId: 0, raceNumber: 64 } : i === 19 ? { teamId: 0, raceNumber: 2 } : { teamId: 5 + Math.floor(i / 2), raceNumber: 10 + i })),
  raceSamples: [
    { offsetMin: 0, weather: 1, rainPct: 12 },
    { offsetMin: 30, weather: 3, rainPct: 45 },
  ],
};

describe('synthetic session recordings', () => {
  it('replays to a live state whose next forecast is the race samples', () => {
    const tracker = new SessionTracker({ feedId: feedId('synthetic') });
    const events = [...syntheticPackets(QUALIFYING).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs)), ...tracker.end()];
    const frames = events.flatMap((e) => (e.type === 'frame' ? [e.frame] : [])) as Frame[];
    const runner = new SessionRunner({ feedId: feedId('synthetic'), sessionUid: frames[0]!.sessionUid, session: frames[0]!.session! });
    for (const f of frames) runner.apply(f);
    runner.end();
    const next = runner.state.session.nextForecast;
    expect(next.map((s) => s.offsetMs)).toEqual([0, 1_800_000]);
    expect(next.map((s) => s.rainPct)).toEqual([12, 45]);
    expect(next.map((s) => s.weather)).toEqual(['lightCloud', 'lightRain']);
  });

  it('writes a file under 1 MB, the same bytes for the same input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pitwall-synthetic-'));
    await writeSynthetic(join(dir, 'a.pwrec.gz'), QUALIFYING);
    await writeSynthetic(join(dir, 'b.pwrec.gz'), QUALIFYING);
    expect(statSync(join(dir, 'a.pwrec.gz')).size).toBeLessThan(1_000_000);
    expect(readFileSync(join(dir, 'a.pwrec.gz')).equals(readFileSync(join(dir, 'b.pwrec.gz')))).toBe(true);
  });
});
