// A basis naming a session the feed never stored (SP4.3e Task 7a-2, plan Step 1 row (e), Review focus 1; C3, C38, C62;
// spec §4.2): "a session the feed has not stored is missing from its context". A choice on feed A names a practice A's
// seat has and B's seat never stored, and a qualifying no seat stored: nothing throws, both feeds commit the decision,
// each `view.basis` names the whole basis but holds only the sessions its own seat stored, and each recording replays
// alone to the same `view.basis` per frame. Seam: `./basis-support.ts`.
import { describe, expect, it } from 'vitest';
import { A, AT, B, basisPerFrame, bridge, builder, chosen, decisionsOf, last, RACE_UID, refOf, replay, SESSION_TYPE, settle, slice, storeSession } from './basis-support.ts';

const EARLIER = 56;
const LOBBY = 57;

describe('a basis naming a session the feed never stored (C62)', () => {
  it('(e) a basis naming a session the feed never stored: no throw, view.basis lacks it, replay equal (Review focus 1)', async () => {
    const b = bridge();
    // the practice is stored for A's seat (player car 0) only
    const practice = await storeSession(b.db, { uid: 90n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    // a qualifying no seat of this bridge ever stored
    const unknownQualifying = refOf(999n, EARLIER);
    const basis = { practice: [practice], qualifying: unknownQualifying };

    const a = b.feed(A);
    const bb = b.feed(B);
    const packetsA = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 0 }).frames(20, () => {}).packets();
    const packetsB = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 1 }).frames(20, () => {}).packets();
    a.push(slice(packetsA, 0, 6));
    bb.push(slice(packetsB, 0, 6));
    expect([...b.teams.teamOf(A)].sort()).toEqual([A, B]);

    const routing = await b.routing();
    expect(await routing.choose({ kind: 'basis.choose', feedId: A, basis, plan: undefined })).toEqual({ ok: true });
    await settle();
    a.push(slice(packetsA, 6, 20));
    bb.push(slice(packetsB, 6, 20));
    const [fileA, fileB] = [await a.end(), await bb.end()];

    // no frame was skipped by a failing unit or a throw: the probe ran on every frame after the choice on both feeds
    const decision = { kind: 'basisChosen', basis, frame: expect.any(Number) };
    expect(chosen(last(a.seen))).toEqual([decision]);
    expect(chosen(last(bb.seen))).toEqual([decision]);
    // A has its practice, never the unknown qualifying; B has neither
    expect(last(a.seen)).toMatchObject({ basis, sessions: ['90/0'] });
    expect(last(bb.seen)).toMatchObject({ basis, sessions: [] });
    // the sessions no seat stored were never made current: nothing to rebuild
    expect(b.rebuild.calls.flatMap((c) => c.refs).filter((k) => k.sessionUid === unknownQualifying.sessionUid)).toEqual([]);
    expect(b.rebuild.calls.flatMap((c) => c.refs).filter((k) => k.sessionUid === practice.sessionUid && k.playerCar === 1)).toEqual([]);
    // both sidecars hold the decision as chosen, never their data (C76)
    expect(decisionsOf(fileA).map((e) => e.decision)).toEqual([{ kind: 'basisChosen', basis }]);
    expect(decisionsOf(fileB).map((e) => e.decision)).toEqual([{ kind: 'basisChosen', basis }]);

    // each replays alone to the same view.basis per frame (C38)
    expect(basisPerFrame(await replay(b.db, fileA, A))).toEqual(basisPerFrame(a.seen));
    expect(basisPerFrame(await replay(b.db, fileB, B))).toEqual(basisPerFrame(bb.seen));
  });
});
