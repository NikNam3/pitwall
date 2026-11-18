// `basis.choose` across the team's feeds (SP4.3e Task 7a-2, plan Step 1 row (c); C1a, C38, C62, C76; spec §4.2): a
// choice on feed A of a team of two feeds is committed as `basisChosen` on both, each with its own engine's next frame
// and into its own decisions sidecar, each loading the named sessions of its own player's seat; then the plan through
// `PlanChoice.choosePlan`. Each recording replays alone to the same `view.basis` per frame. The race is in a new lobby
// (a weekend of its own, no last choice): it starts on no basis. Seam: `./basis-support.ts`.
import { describe, expect, it } from 'vitest';
import { NO_BASIS } from '@pitwall/domain';
import { A, AT, B, basisPerFrame, bridge, builder, chosen, decisionsOf, last, RACE_UID, replay, SESSION_TYPE, settle, slice, storeSession, TEAM, TRACK } from './basis-support.ts';

const EARLIER = 50;
const LOBBY = 51;

describe('basis.choose on a team of two feeds (C1a, C62, C76)', () => {
  it('(c) basis.choose on feed A of a team of two feeds: both feeds\' decision sidecars hold the basisChosen', async () => {
    const b = bridge();
    // the practice of the earlier weekend, stored for both seats of team 3 (player cars 0 and 1)
    const practice = await storeSession(b.db, { uid: 60n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    await storeSession(b.db, { uid: 60n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 1, at: AT.practice });
    const basis = { practice: [practice], qualifying: null };

    const a = b.feed(A);
    const bb = b.feed(B);
    const packetsA = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 0 }).frames(20, () => {}).packets();
    const packetsB = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 1 }).frames(20, () => {}).packets();
    a.push(slice(packetsA, 0, 8));
    bb.push(slice(packetsB, 0, 5));
    expect([...b.teams.teamOf(A)].sort()).toEqual([A, B]);
    // a new lobby, no last choice: no basis
    expect(last(a.seen).basis).toEqual(NO_BASIS);
    expect(last(a.seen).sessions).toEqual([]);

    const routing = await b.routing();
    const answer = await routing.choose({ kind: 'basis.choose', feedId: A, basis, plan: 'plan-texas' });
    expect(answer).toEqual({ ok: true });
    await settle();
    a.push(slice(packetsA, 8, 14));
    bb.push(slice(packetsB, 5, 11));
    const [fileA, fileB] = [await a.end(), await bb.end()];

    // both logs hold it, each feed loading its own seat's session (C62)
    const decision = { kind: 'basisChosen', basis, frame: expect.any(Number) };
    expect(chosen(last(a.seen))).toEqual([decision]);
    expect(chosen(last(bb.seen))).toEqual([decision]);
    expect(last(a.seen)).toMatchObject({ basis, sessions: ['60/0'] });
    expect(last(bb.seen)).toMatchObject({ basis, sessions: ['60/1'] });
    // each at its own engine's next frame: A had applied 3 frames more than B
    expect(chosen(last(a.seen))[0]!.frame - chosen(last(bb.seen))[0]!.frame).toBe(3);
    // both sidecars, each with its own record index
    expect(decisionsOf(fileA).map((e) => e.decision)).toEqual([{ kind: 'basisChosen', basis }]);
    expect(decisionsOf(fileB).map((e) => e.decision)).toEqual([{ kind: 'basisChosen', basis }]);
    expect(decisionsOf(fileA)[0]!.recordIndex).toBeGreaterThan(decisionsOf(fileB)[0]!.recordIndex);
    // the named sessions were made current first (C61), for the running session's basis
    expect(b.rebuild.calls.some((c) => c.priority === 'runningBasis')).toBe(true);
    // then the plan, once, for the team on the track (C62d)
    expect(b.plans.choosePlan).toHaveBeenCalledTimes(1);
    expect(b.plans.choosePlan).toHaveBeenCalledWith(TEAM, TRACK, 'plan-texas');

    // each recording replays alone to the same view.basis per frame (C38)
    expect(basisPerFrame(await replay(b.db, fileA, A))).toEqual(basisPerFrame(a.seen));
    expect(basisPerFrame(await replay(b.db, fileB, B))).toEqual(basisPerFrame(bb.seen));
  });

  it('(c) a choice that keeps the plan (plan undefined) commits the basis and chooses no plan', async () => {
    const b = bridge();
    const practice = await storeSession(b.db, { uid: 61n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const a = b.feed(A);
    const packets = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 0 }).frames(12, () => {}).packets();
    a.push(slice(packets, 0, 6));
    const routing = await b.routing();
    expect(await routing.choose({ kind: 'basis.choose', feedId: A, basis: { practice: [practice], qualifying: null }, plan: undefined })).toEqual({ ok: true });
    await settle();
    a.push(slice(packets, 6, 12));
    const file = await a.end();
    expect(decisionsOf(file).map((e) => e.decision.kind)).toEqual(['basisChosen']);
    expect(last(a.seen).sessions).toEqual(['61/0']);
    expect(b.plans.choosePlan).not.toHaveBeenCalled();
  });
});
