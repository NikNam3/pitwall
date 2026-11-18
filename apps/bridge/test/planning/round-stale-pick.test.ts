// SP4.3f Task 3, a stale pick waits (C61, C62d; spec §4.2 "A stale pick waits"): a picked session whose rules version is
// stale is rebuilt first, through the rebuild service's `ensureCurrent` with priority `planning` (one rebuild at a time,
// off the thread that applies frames). The round is published open with `rebuilding: true` while `ensureCurrent` of the
// qualifying row and the practice rows runs; then `rebuilding: false` and the replay.
//
// Synthetic sessions in fresh temporary data dirs (C84): the stale one stored under an older rules version. Every
// `ensureCurrent` is held until the test lets it go, so the state while it runs is seen (`round-harness.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanUp, newPlace, OLDER_RULES, planningOf, rowsOf, RULES, storePractice, storeQualifying, TEAM, type Stored } from './round-harness.ts';

afterEach(cleanUp);

/** A gate the harness's `ensureCurrent` waits for. */
function gate(): { hold: Promise<void>; release: () => void } {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { hold, release };
}

/** The pick `stale` rebuilt and replayed after: rebuilding while held, then the replay, `stale`'s row current at the end. */
async function waitsFor(o: { qualifying: Stored; practice: Stored[]; stale: Stored; place: ReturnType<typeof newPlace>; g: ReturnType<typeof gate>; p: ReturnType<typeof planningOf> }) {
  const { p, g } = o;
  expect(p.open({ qualifying: o.qualifying.ref, team: TEAM, practice: o.practice.map((s) => s.ref) })).toEqual({ ok: true });

  // while the rebuild runs: the round is open and rebuilding, nothing replayed yet
  await vi.waitFor(() => expect(p.prepared().at(-1)).toMatchObject({ open: true, rebuilding: true }), { timeout: 30_000 });
  expect(p.round()).toMatchObject({ qualifying: o.qualifying.ref, team: TEAM });
  expect(p.replays()).toEqual([]);
  expect(p.ensured().some((c) => c.priority === 'planning' && c.refs.some((k) => k.sessionUid === o.stale.key.sessionUid && k.playerCar === o.stale.key.playerCar))).toBe(true);
  for (const c of p.ensured()) expect(c.priority).toBe('planning');

  g.release();
  await vi.waitFor(() => expect(p.replays()).toHaveLength(1), { timeout: 60_000 });
  await p.settled(1);
  // every ensureCurrent came before the replay
  const lastEnsure = p.calls.findLastIndex((c) => c.kind === 'ensureCurrent');
  expect(lastEnsure).toBeLessThan(p.calls.findIndex((c) => c.kind === 'replayToEnd'));
  // rebuilding was published before the replay's state, and is false at the end
  const states = p.prepared();
  expect(states.findIndex((s) => s.open && s.rebuilding)).toBeGreaterThanOrEqual(0);
  expect(states.at(-1)).toMatchObject({ open: true, rebuilding: false, running: false });
  // the stale row is current now (the real service rebuilt it)
  expect(rowsOf(o.place, o.stale.ref).find((r) => r.playerCar === o.stale.key.playerCar)?.rulesVersion).toBe(RULES);
}

describe('a stale pick waits for its rebuild (SP4.3f Task 3; C61, C62d)', { timeout: 180_000 }, () => {
  it('a stale practice: rebuilding true published, ensureCurrent called with the practice row\'s key and priority planning, then rebuilding false and the replay', async () => {
    const place = newPlace();
    const qualifying = await storeQualifying(place);
    const practice = await storePractice(place, { rules: OLDER_RULES });
    const g = gate();
    const p = planningOf(place, { hold: g.hold });
    await waitsFor({ place, qualifying, practice: [practice], stale: practice, g, p });
    expect(p.replays()[0]!.job.basisOverride).toEqual([practice.key]);
  });

  it('a stale qualifying: its row is made current before its recording is replayed', async () => {
    const place = newPlace();
    const qualifying = await storeQualifying(place, { rules: OLDER_RULES });
    const g = gate();
    const p = planningOf(place, { hold: g.hold });
    await waitsFor({ place, qualifying, practice: [], stale: qualifying, g, p });
    expect(p.replays()[0]!.job.pwrecPath).toBe(qualifying.file);
  });
});
