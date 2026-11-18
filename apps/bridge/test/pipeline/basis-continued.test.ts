// A continued recording's basis (SP4.3e Task 7a-2 fix round, F2; C38, C59, C61, C62; spec §4.2): a live race started on
// its own weekend's practice and qualifying, both current, and the bridge stopped mid-session. After a bridge update the
// rules version differs (C90): the qualifying is stale. The restarted bridge continues the recording (C59) on its
// sidecar's `start`, from its first frame on the start's current sessions: a running session never waits (C61). The
// start's stale session is queued (`ensureCurrent`, priority `runningBasis`), as the live preselection's stale ones are,
// and once it is current the start enters by a `basisChosen` naming it (C62), committed to the decisions sidecar.
// Seam: `./basis-support.ts` (`Feed.halt`, a restart's `feed(id, wall, recordingsDir)`).
import { describe, expect, it, vi } from 'vitest';
import { A, AT, basisSidecarOf, bridge, builder, chosen, decisionsOf, keyOf, last, markStale, RACE_UID, SESSION_TYPE, sessionAgain, settle, slice, storeSession } from './basis-support.ts';

const WEEKEND = 73;

describe('a continued recording with a stale start session (C59, C61, C62)', () => {
  it("a continuation with a stale start session starts on the current ones without waiting and gets the rest by a basisChosen naming the start once it is current", async () => {
    const b = bridge();
    const practice = await storeSession(b.db, { uid: 90n, weekend: WEEKEND, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const qualifying = await storeSession(b.db, { uid: 91n, weekend: WEEKEND, type: SESSION_TYPE.qualifying, player: 0, at: AT.qualifying });
    const start = { practice: [practice], qualifying };
    const race = { uid: RACE_UID, weekend: WEEKEND, type: SESSION_TYPE.race, player: 0 };
    // the game repeats its Session packet at frame 15, where the restarted bridge picks the session up
    const packets = sessionAgain(builder(race).frames(15, () => {}), race).frames(25, () => {}).packets();

    // the first run: both current, started on both; the bridge stops mid-session
    const first = b.feed(A);
    first.push(slice(packets, 0, 15));
    await settle();
    expect(last(first.seen).sessions).toEqual(['90/0', '91/0']);
    const file = first.file();
    await first.halt();
    expect(basisSidecarOf(file)).toEqual({ start, preselected: start });

    // a bridge update: the qualifying is stale; its rebuild is held
    const stale = keyOf(qualifying, 0);
    markStale(b.db, stale);
    b.rebuild.hold(stale);
    const callsBefore = b.rebuild.calls.length;

    // the restart continues the recording (C59): the same session file, its sidecars kept
    const restarted = b.feed(A, AT.race + 60_000, first.dir);
    restarted.push(slice(packets, 15, 25));
    // a running session never waits (C61): the restore replays the recording and goes live, while the rebuild is held
    await vi.waitFor(() => expect(restarted.seen.some((s) => s.at >= last(first.seen).at)).toBe(true), { timeout: 10_000 });
    await settle();
    // it runs on the start's current session alone
    for (const s of restarted.seen) {
      expect(s.basis).toEqual(start);
      expect(s.sessions).toEqual(['90/0']);
      expect(chosen(s)).toEqual([]);
    }
    // the start's stale session is queued for the running session's basis
    const queued = b.rebuild.calls.slice(callsBefore).filter((c) => c.priority === 'runningBasis').flatMap((c) => c.refs);
    expect(queued).toContainEqual(stale);
    expect(decisionsOf(file)).toEqual([]);

    // the rebuild finishes: the start enters by decision with the next frame
    b.rebuild.release(stale);
    await settle();
    const before = restarted.seen.length;
    restarted.push(slice(packets, 25, 40));
    await settle();
    const entered = restarted.seen.findIndex((s, i) => i >= before && chosen(s).length > 0);
    expect(entered).toBeGreaterThanOrEqual(before);
    expect(chosen(restarted.seen[entered]!)).toEqual([{ kind: 'basisChosen', basis: start, frame: expect.any(Number) }]);
    for (const s of restarted.seen.slice(entered)) {
      expect(s.basis).toEqual(start);
      expect(s.sessions).toEqual(['90/0', '91/0']);
    }
    await restarted.end();
    expect(decisionsOf(file).map((e) => e.decision)).toEqual([{ kind: 'basisChosen', basis: start }]);
    // a continuation never rewrites the basis sidecar (C59)
    expect(basisSidecarOf(file)).toEqual({ start, preselected: start });
  });
});
