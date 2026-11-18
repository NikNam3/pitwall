// Two confirms close together (SP4.3e Task 7a-2, plan Step 1 row (c), Review focus 3; C1a, C62, C76; spec §4.2):
// `basis.choose` is serialised per team, so when the first choice's sessions take longer to become current than the
// second's, both feeds of the team still end with the same newest `basisChosen`, the second, and the same decisions in
// the same order. Seam: `./basis-support.ts`.
import { describe, expect, it } from 'vitest';
import { A, AT, B, bridge, builder, chosen, decisionsOf, keyOf, last, markStale, RACE_UID, SESSION_TYPE, settle, slice, storeSession } from './basis-support.ts';

const EARLIER = 52;
const LOBBY = 53;

describe('two confirms on one team (C1a, C62)', () => {
  it('(c) two confirms 100 ms apart end with the same newest decision on both feeds (Review focus 3)', async () => {
    const b = bridge();
    // two practices of the earlier weekend, each stored for both seats of team 3
    const slow = await storeSession(b.db, { uid: 70n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    await storeSession(b.db, { uid: 70n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 1, at: AT.practice });
    const fast = await storeSession(b.db, { uid: 71n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.qualifying });
    await storeSession(b.db, { uid: 71n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 1, at: AT.qualifying });
    // the first choice's session is stale and its rebuild takes a while, for both seats
    for (const player of [0, 1]) {
      markStale(b.db, keyOf(slow, player));
      b.rebuild.hold(keyOf(slow, player));
    }
    const first = { practice: [slow], qualifying: null };
    const second = { practice: [fast], qualifying: null };

    const a = b.feed(A);
    const bb = b.feed(B);
    const packetsA = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 0 }).frames(24, () => {}).packets();
    const packetsB = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 1 }).frames(24, () => {}).packets();
    a.push(slice(packetsA, 0, 6));
    bb.push(slice(packetsB, 0, 6));
    expect([...b.teams.teamOf(A)].sort()).toEqual([A, B]);

    const routing = await b.routing();
    // the first confirm from A; 100 ms later a second from B, whose sessions are current at once
    const one = routing.choose({ kind: 'basis.choose', feedId: A, basis: first, plan: undefined });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const two = routing.choose({ kind: 'basis.choose', feedId: B, basis: second, plan: undefined });
    await settle();
    a.push(slice(packetsA, 6, 10));
    bb.push(slice(packetsB, 6, 10));
    // the first one's rebuild finishes after the second was confirmed
    for (const player of [0, 1]) b.rebuild.release(keyOf(slow, player));
    expect(await one).toEqual({ ok: true });
    expect(await two).toEqual({ ok: true });
    await settle();
    a.push(slice(packetsA, 10, 24));
    bb.push(slice(packetsB, 10, 24));
    const [fileA, fileB] = [await a.end(), await bb.end()];

    // the same newest decision, the second confirm, on both feeds
    expect(chosen(last(a.seen)).at(-1)?.basis).toEqual(second);
    expect(chosen(last(bb.seen)).at(-1)?.basis).toEqual(second);
    expect(last(a.seen)).toMatchObject({ basis: second, sessions: ['71/0'] });
    expect(last(bb.seen)).toMatchObject({ basis: second, sessions: ['71/1'] });
    // and the same decisions in the same order, in both sidecars
    const order = (file: string) => decisionsOf(file).map((e) => JSON.stringify(e.decision));
    expect(order(fileA)).toEqual(order(fileB));
    expect(JSON.parse(order(fileA).at(-1)!)).toEqual({ kind: 'basisChosen', basis: second });
    expect(chosen(last(a.seen)).map((d) => d.basis)).toEqual(chosen(last(bb.seen)).map((d) => d.basis));
  });
});
