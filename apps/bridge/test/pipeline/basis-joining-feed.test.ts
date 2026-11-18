// A feed that joins the team after a basis choice (SP4.3e Task 7a-2, plan Step 1 row (d); C1a, C38, C62, C76; spec
// §4.2): it is handed the team's newest `basisChosen` at its first frame with its team known, loads the named sessions
// of its own player's seat, writes the decision to its own decisions sidecar, and its recording replays alone to the
// same `view.basis` per frame. Seam: `./basis-support.ts`.
import { describe, expect, it } from 'vitest';
import { PacketId } from '@pitwall/protocol';
import { A, AT, B, basisPerFrame, bridge, builder, chosen, decisionsOf, last, RACE_UID, replay, SESSION_TYPE, settle, slice, storeSession, TEAMS } from './basis-support.ts';

const EARLIER = 54;
const LOBBY = 55;

describe('a feed that joins the team later (C1a, C62)', () => {
  it('(d) a feed that joins after the choice gets it at its first frame with the team known', async () => {
    const b = bridge();
    const older = await storeSession(b.db, { uid: 80n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    await storeSession(b.db, { uid: 80n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 1, at: AT.practice });
    const newer = await storeSession(b.db, { uid: 81n, weekend: EARLIER, type: SESSION_TYPE.qualifying, player: 0, at: AT.qualifying });
    await storeSession(b.db, { uid: 81n, weekend: EARLIER, type: SESSION_TYPE.qualifying, player: 1, at: AT.qualifying });

    // A alone chooses twice: the newest is what a joining feed is handed
    const a = b.feed(A);
    const packetsA = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 0 }).frames(30, () => {}).packets();
    a.push(slice(packetsA, 0, 6));
    const routing = await b.routing();
    expect(await routing.choose({ kind: 'basis.choose', feedId: A, basis: { practice: [older], qualifying: null }, plan: undefined })).toEqual({ ok: true });
    await settle();
    a.push(slice(packetsA, 6, 8));
    const newest = { practice: [older], qualifying: newer };
    expect(await routing.choose({ kind: 'basis.choose', feedId: A, basis: newest, plan: undefined })).toEqual({ ok: true });
    await settle();
    a.push(slice(packetsA, 8, 12));
    expect(last(a.seen)).toMatchObject({ basis: newest, sessions: ['80/0', '81/0'] });

    // B's session starts without Participants (the builder's leading one is dropped); they arrive with its frame 5
    const bb = b.feed(B);
    const later = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 1 })
      .frames(5, () => {})
      .participants({ participants: TEAMS.map((teamId) => ({ teamId })) })
      .frames(10, () => {})
      .packets();
    const firstParticipants = later.findIndex(({ packet }) => packet.packetId === PacketId.participants);
    const secondParticipants = later.findIndex(({ packet }, i) => i > firstParticipants && packet.packetId === PacketId.participants);
    bb.push(later.slice(0, secondParticipants).filter((_, i) => i !== firstParticipants));
    expect([...b.teams.teamOf(B)]).toEqual([B]);
    expect(bb.seen.every((s) => chosen(s).length === 0)).toBe(true);
    const before = bb.seen.length;

    bb.push(later.slice(secondParticipants));
    await settle();
    expect([...b.teams.teamOf(B)].sort()).toEqual([A, B]);
    // B's held frames (the identity wait) are applied first; the choice arrives on its frame with Participants (C76, C10)
    const joinedAt = bb.seen.findIndex((s, i) => i >= before && chosen(s).length > 0);
    expect(joinedAt, 'B got the choice').toBeGreaterThanOrEqual(before);
    expect(bb.seen.slice(before, joinedAt).every((s) => chosen(s).length === 0)).toBe(true);
    // only the team's newest, loaded for B's own seat (player car 1)
    expect(chosen(bb.seen[joinedAt]!)).toEqual([{ kind: 'basisChosen', basis: newest, frame: expect.any(Number) }]);
    for (const s of bb.seen.slice(joinedAt)) expect(s).toMatchObject({ basis: newest, sessions: ['80/1', '81/1'] });
    // A's log is unchanged by B joining
    expect(chosen(last(a.seen))).toHaveLength(2);

    // B's sidecar holds it, so its recording replays alone (C38)
    const fileB = await bb.end();
    expect(decisionsOf(fileB).map((e) => e.decision)).toEqual([{ kind: 'basisChosen', basis: newest }]);
    expect(basisPerFrame(await replay(b.db, fileB, B))).toEqual(basisPerFrame(bb.seen));
  });
});
