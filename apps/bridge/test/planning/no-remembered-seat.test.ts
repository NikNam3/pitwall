// SP4.3f Task 3, the remembered feed seat deleted (C62d, C70, C82; spec §4.2 "Team, last choice and saved plans"): the
// round's team, and so its saved plans and last choice, is the picked qualifying's; a feed's seat is never remembered
// across bridge starts (`feed-seats.ts`, R19, and the hand-seeded `PITWALL_DATA_DIR/feeds/` files are gone). A bridge
// started with no session and an old `feeds/udp-20777.json` lists no saved plans on its closed `plans.prepared` (no
// round was opened on the feed, so it has no team), and it neither reads nor writes the file.
//
// A live `serve` with no traffic on a fresh temporary data dir (C84); `node:fs`'s reads are spied on.
import type * as Fs from 'node:fs';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMPORTED } from '@pitwall/domain';
import { SavedPlanStore } from '../../src/planning/saved-plans.ts';
import { cleanUp, newPlace, serveBridge, silent, TEAM, TRACK } from './round-harness.ts';

/** Every path `readFileSync` was asked for, in this test file's module graph (the bridge's modules included). */
const reads = vi.hoisted(() => [] as string[]);
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  const readFileSync = ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
    reads.push(String(path));
    return (fs.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.readFileSync;
  return { ...fs, default: { ...fs, readFileSync }, readFileSync };
});

afterEach(cleanUp);

describe('no remembered seat (SP4.3f Task 3; C62d, C70)', { timeout: 120_000 }, () => {
  it('serve with an existing feeds/udp-20777.json and no session: plans.prepared closed with no saved plans; the file is neither read nor written', async () => {
    const place = newPlace();
    const root = place.dirs.root;
    // the file SP4.3e wrote: the feed's last seat (team 0, #2) on the track
    mkdirSync(join(root, 'feeds'), { recursive: true });
    const file = join(root, 'feeds', 'udp-20777.json');
    writeFileSync(file, `${JSON.stringify({ team: TEAM, raceNumber: 2, trackId: TRACK, at: '2026-11-17T20:00:00.000Z' }, null, 2)}\n`);
    const before = { text: readFileSync(file, 'utf8'), mtimeMs: statSync(file).mtimeMs };
    // a saved plan of that team on that track, which the remembered seat would have listed
    new SavedPlanStore(root, silent).save({
      id: 'evening',
      name: 'evening',
      team: TEAM,
      trackId: TRACK,
      savedAt: '2026-11-17T20:30:00.000Z',
      computedOn: { basis: { practice: [], qualifying: null }, race: { laps: 5, sets: 'carried', conditions: IMPORTED }, forecast: [], profiles: null },
      cars: [{ raceNumber: 2, slots: {}, active: null }],
    });
    reads.length = 0;

    const b = await serveBridge(place);
    await vi.waitFor(() => expect(b.prepared().at(-1)).toEqual({ open: false, saved: [] }), { timeout: 15_000 });
    // no round opened on the feed: no team owns a plan here (C73)
    expect(await b.send({ kind: 'plans.rename', feedId: 'udp-20777', id: 'evening', name: 'x' })).toMatchObject({ ok: false, reason: 'invalid' });
    await b.stop();

    // the spy sees the bridge's reads (its UI state at least), and none of the feed's file
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((path) => path.includes(join(root, 'feeds')))).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(before.text);
    expect(statSync(file).mtimeMs).toBe(before.mtimeMs);
  });
});
