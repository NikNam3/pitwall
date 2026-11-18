// SP4.3e Task 7b, row (c), the store half (C62d, C70, C1a; spec §4.3 "Saved plans"): the team's saved plans, bridge
// user state, one file per plan, `PITWALL_DATA_DIR/plans/<team>/<id>.json`, written atomically; tied to no session, each
// noting the basis and the race assumptions it was computed on (`computedOn`, for display only). `list(team, trackId)`
// gives the team's plans on the track; `read(id)`, `save(plan)`, `rename(id, name)`, `delete(id)`. A file that is no
// saved plan is skipped with a warning (C3). The uiAction half (`plans.save` from the round) is in
// `planning-round.test.ts`. Every test owns a temporary data dir (C84), never the real one.
//
// Assumes `apps/bridge/src/planning/saved-plans.ts` (new in the implement phase): `new SavedPlanStore(dataDir, log)`
// with `dataDir` the data dir (`PITWALL_DATA_DIR`), as `PreparedStore` and `createLastChoiceStore` take it. The import
// fails until then.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMPORTED, type Policy, type SavedPlan } from '@pitwall/domain';
import { SavedPlanStore } from '../../src/planning/saved-plans.ts';

const MERCEDES = 0;
const FERRARI = 1;
const AUSTIN = 15;
const MONZA = 11;

const POLICY_A: Policy = { startCompound: 'medium', stops: [{ lap: 20, compound: 'hard' }] };
const POLICY_B: Policy = { startCompound: 'soft', stops: [{ lap: 12, compound: 'medium' }, { lap: 30, compound: 'hard' }] };

const dirs: string[] = [];
const dataDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pitwall-saved-plans-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const warnLog = () => ({ warn: vi.fn() });

const plan = (o: Partial<SavedPlan> & Pick<SavedPlan, 'id'>): SavedPlan => ({
  name: 'Texas morning',
  team: MERCEDES,
  trackId: AUSTIN,
  savedAt: '2026-11-18T09:40:00.000Z',
  computedOn: {
    basis: { practice: [{ sessionUid: '100', weekendId: '7' }], qualifying: { sessionUid: '102', weekendId: '7' } },
    race: { laps: 56, sets: 'fresh', conditions: IMPORTED },
    forecast: [],
    profiles: null,
  },
  cars: [
    { raceNumber: 64, slots: { A: POLICY_A, B: POLICY_B }, active: 'B' },
    { raceNumber: 2, slots: { A: POLICY_A }, active: null },
  ],
  ...o,
});

const fileOf = (dir: string, team: number, id: string): string => join(dir, 'plans', String(team), `${id}.json`);

describe('the saved plans (Task 7b row c; C62d, C70)', () => {
  it('(c) save writes plans/<team>/<id>.json with computedOn; a new store over the same dir lists it (a restart)', () => {
    const dir = dataDir();
    const log = warnLog();
    const store = new SavedPlanStore(dir, log);
    const morning = plan({ id: 'texas-morning' });
    store.save(morning);
    const file = fileOf(dir, MERCEDES, 'texas-morning');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(morning);
    expect((JSON.parse(readFileSync(file, 'utf8')) as SavedPlan).computedOn).toEqual({
      basis: { practice: [{ sessionUid: '100', weekendId: '7' }], qualifying: { sessionUid: '102', weekendId: '7' } },
      race: { laps: 56, sets: 'fresh', conditions: IMPORTED },
    forecast: [],
    profiles: null,
    });
    // atomic: no temp file left behind
    expect(readdirSync(join(dir, 'plans', String(MERCEDES)))).toEqual(['texas-morning.json']);

    const again = new SavedPlanStore(dir, log);
    expect(again.list(MERCEDES, AUSTIN)).toEqual([morning]);
    expect(again.read('texas-morning')).toEqual(morning);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('list gives the team\'s plans on the track only', () => {
    const dir = dataDir();
    const store = new SavedPlanStore(dir, warnLog());
    const austin1 = plan({ id: 'a1' });
    const austin2 = plan({ id: 'a2', name: 'Texas evening', savedAt: '2026-11-18T17:30:00.000Z' });
    const monza = plan({ id: 'm1', trackId: MONZA });
    const ferrari = plan({ id: 'f1', team: FERRARI });
    for (const p of [austin1, austin2, monza, ferrari]) store.save(p);
    expect(store.list(MERCEDES, AUSTIN)).toEqual(expect.arrayContaining([austin1, austin2]));
    expect(store.list(MERCEDES, AUSTIN)).toHaveLength(2);
    expect(store.list(MERCEDES, MONZA)).toEqual([monza]);
    expect(store.list(FERRARI, AUSTIN)).toEqual([ferrari]);
    expect(store.list(FERRARI, MONZA)).toEqual([]);
    expect(existsSync(fileOf(dir, FERRARI, 'f1'))).toBe(true);
  });

  it('save of an existing id replaces it; rename changes only the name; delete removes the file', () => {
    const dir = dataDir();
    const store = new SavedPlanStore(dir, warnLog());
    store.save(plan({ id: 'p' }));
    const replaced = plan({ id: 'p', cars: [{ raceNumber: 64, slots: { A: POLICY_B }, active: 'A' }] });
    store.save(replaced);
    expect(store.read('p')).toEqual(replaced);

    store.rename('p', 'Texas final');
    expect(store.read('p')).toEqual({ ...replaced, name: 'Texas final' });
    expect(new SavedPlanStore(dir, warnLog()).read('p')?.name).toBe('Texas final');

    store.delete('p');
    expect(store.read('p')).toBeUndefined();
    expect(existsSync(fileOf(dir, MERCEDES, 'p'))).toBe(false);
    expect(store.list(MERCEDES, AUSTIN)).toEqual([]);
  });

  it('an unknown id reads undefined; no plans dir lists none', () => {
    const store = new SavedPlanStore(dataDir(), warnLog());
    expect(store.read('none')).toBeUndefined();
    expect(store.list(MERCEDES, AUSTIN)).toEqual([]);
  });

  it('a file that is no saved plan is skipped with a warning (C3)', () => {
    const dir = dataDir();
    const log = warnLog();
    const store = new SavedPlanStore(dir, log);
    const good = plan({ id: 'good' });
    store.save(good);
    mkdirSync(join(dir, 'plans', String(MERCEDES)), { recursive: true });
    writeFileSync(fileOf(dir, MERCEDES, 'broken'), '{ not json');
    writeFileSync(fileOf(dir, MERCEDES, 'wrong'), JSON.stringify({ id: 'wrong', cars: 'none' }));
    expect(store.list(MERCEDES, AUSTIN)).toEqual([good]);
    expect(store.read('broken')).toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});
