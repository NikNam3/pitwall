// A stale preselected session and the replay (SP4.3e Task 7a-2, plan Step 1 row (b); C38, C59, C61, C62, C76; spec
// §4.2): the race preselects its own weekend's practice and qualifying; the qualifying is stale, so the session starts on
// the practice alone, from its first frame (no frame waits for the rebuild), with the stale one queued at priority
// `runningBasis`. Once it is current, a `basisChosen` naming the whole preselection is committed and written to the
// decisions sidecar. The reprocess of the session file, with its sidecars, gives the same `view.basis` at every frame.
// Seam: `./basis-support.ts`.
import { describe, expect, it } from 'vitest';
import { A, AT, basisPerFrame, basisSidecarOf, bridge, builder, chosen, decisionsOf, keyOf, last, markStale, RACE_UID, replay, SESSION_TYPE, settle, slice, storeSession } from './basis-support.ts';

const WEEKEND = 42;

describe('a stale preselected session (C61, C62)', () => {
  it('(b) a preselected stale session: the session runs from its first frame on the current ones; after the rebuild a basisChosen naming the whole preselection is in the decisions sidecar; the replay gives the same view.basis at every frame', async () => {
    const b = bridge();
    const practice = await storeSession(b.db, { uid: 33n, weekend: WEEKEND, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const qualifying = await storeSession(b.db, { uid: 34n, weekend: WEEKEND, type: SESSION_TYPE.qualifying, player: 0, at: AT.qualifying });
    const stale = keyOf(qualifying, 0);
    markStale(b.db, stale);
    b.rebuild.hold(stale);
    const preselected = { practice: [practice], qualifying };
    const start = { practice: [practice], qualifying: null };

    const a = b.feed(A);
    const packets = builder({ uid: RACE_UID, weekend: WEEKEND, type: SESSION_TYPE.race, player: 0 }).frames(30, () => {}).packets();
    a.push(slice(packets, 0, 10));
    await settle();
    // the session runs while the rebuild waits: every frame so far on the current practice alone
    const before = a.seen.length;
    expect(before).toBeGreaterThan(0);
    for (const s of a.seen) {
      expect(s.basis).toEqual(start);
      expect(s.sessions).toEqual(['33/0']);
      expect(chosen(s)).toEqual([]);
    }
    // the sidecar: started on the current one, the whole preselection for display
    expect(basisSidecarOf(a.file())).toEqual({ start, preselected });
    // the stale one is queued for the running session's basis (C61)
    const queued = b.rebuild.calls.filter((c) => c.priority === 'runningBasis').flatMap((c) => c.refs);
    expect(queued).toContainEqual(stale);
    expect(decisionsOf(a.file())).toEqual([]);

    // the rebuild finishes: the preselection enters by decision with the next frame
    b.rebuild.release(stale);
    await settle();
    a.push(slice(packets, 10, 30));
    const file = await a.end();
    const entered = a.seen.findIndex((s, i) => i >= before && chosen(s).length > 0);
    expect(entered).toBeGreaterThanOrEqual(before);
    expect(chosen(a.seen[entered]!)).toEqual([{ kind: 'basisChosen', basis: preselected, frame: expect.any(Number) }]);
    for (const s of a.seen.slice(entered)) {
      expect(s.basis).toEqual(preselected);
      expect(s.sessions).toEqual(['33/0', '34/0']);
    }
    expect(chosen(last(a.seen))).toHaveLength(1);
    expect(decisionsOf(file).map((e) => e.decision)).toEqual([{ kind: 'basisChosen', basis: preselected }]);
    // the sidecar keeps the session-start basis
    expect(basisSidecarOf(file)).toEqual({ start, preselected });

    // the reprocess of the session file (C38): the same view.basis at every frame
    const replayed = await replay(b.db, file, A);
    expect(basisPerFrame(replayed)).toEqual(basisPerFrame(a.seen));
    expect(last(replayed).decisions).toEqual(last(a.seen).decisions);
  });
});
