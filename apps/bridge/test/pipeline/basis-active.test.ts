// `basis.active` publishing (SP4.3e Task 7a-2, round 2; C54, C55, C62, spec §4.2): a live feed whose seat has a stored
// practice publishes `basis.active` from its pipeline (a core topic, not through a binding): the basis in use, its
// session-start value, per named session (`<sessionUid>@<weekendId>`) its date, kind and track, the plan (`null`: none
// chosen), the race's laps (`null` outside a race), the rebuild progress while a stale preselected session is queued
// (`{ done, total }` from `ensureCurrent`'s `onProgress`, then `null`), and the team's last confirmed choice on the
// track. After a `basisChosen` the published basis follows it at that frame. Seam: `./basis-support.ts`.
import { describe, expect, it } from 'vitest';
import { NO_BASIS, type TrackId } from '@pitwall/domain';
import type { LastChoice } from '../../src/pipeline/last-choice-types.ts';
import { A, AT, bridge, builder, chosen, keyOf, last, markStale, RACE_UID, SESSION_TYPE, settle, slice, storeSession, TRACK, type BasisActive } from './basis-support.ts';

/** The builder session's laps (`ScenarioBuilder`'s default `totalLaps`). */
const RACE_LAPS = 10;
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The newest published value, which must exist. */
const value = (v: BasisActive | undefined): BasisActive => {
  expect(v, 'basis.active published').toBeDefined();
  return v!;
};

describe('basis.active (C54, C62)', () => {
  it('a live race whose seat has a stored practice publishes basis.active: basis, start, sessions, plan null, raceLaps, rebuilding while a stale preselected session is queued, then null, lastChoice', async () => {
    const WEEKEND = 43;
    const b = bridge();
    const practice = await storeSession(b.db, { uid: 35n, weekend: WEEKEND, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const qualifying = await storeSession(b.db, { uid: 36n, weekend: WEEKEND, type: SESSION_TYPE.qualifying, player: 0, at: AT.qualifying });
    const stale = keyOf(qualifying, 0);
    markStale(b.db, stale);
    b.rebuild.hold(stale);
    const start = { practice: [practice], qualifying: null };
    const preselected = { practice: [practice], qualifying };

    const a = b.feed(A);
    const packets = builder({ uid: RACE_UID, weekend: WEEKEND, type: SESSION_TYPE.race, player: 0 }).frames(24, () => {}).packets();
    a.push(slice(packets, 0, 10));
    await settle();

    // while the stale qualifying is queued: the session-start basis, the rebuild's progress (none done of one)
    const queued = value(b.active(A));
    expect(queued).toMatchObject({ basis: start, start, plan: null, raceLaps: RACE_LAPS, rebuilding: { done: 0, total: 1 }, lastChoice: null });
    const practiceKey = `${practice.sessionUid}@${practice.weekendId}`;
    expect(queued.sessions[practiceKey]).toMatchObject({ kind: 'practice', trackId: TRACK });
    expect(queued.sessions[practiceKey]!.date.slice(0, 10)).toBe(dayOf(AT.practice));

    // the rebuild finishes: the preselection enters by decision, the progress is gone
    b.rebuild.release(stale);
    await settle();
    a.push(slice(packets, 10, 24));
    await settle();
    const entered = value(b.active(A));
    expect(chosen(last(a.seen))).toHaveLength(1);
    expect(entered).toMatchObject({ basis: preselected, start, plan: null, raceLaps: RACE_LAPS, rebuilding: null, lastChoice: null });
    const qualifyingKey = `${qualifying.sessionUid}@${qualifying.weekendId}`;
    expect(entered.sessions[practiceKey]).toMatchObject({ kind: 'practice', trackId: TRACK });
    expect(entered.sessions[qualifyingKey]).toMatchObject({ kind: 'qualifying', trackId: TRACK });
    expect(entered.sessions[qualifyingKey]!.date.slice(0, 10)).toBe(dayOf(AT.qualifying));
    await a.end();
  });

  it('outside a race raceLaps is null; nothing stale: rebuilding is null', async () => {
    const WEEKEND = 44;
    const b = bridge();
    const practice = await storeSession(b.db, { uid: 37n, weekend: WEEKEND, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const a = b.feed(A, AT.qualifying);
    const packets = builder({ uid: 38n, weekend: WEEKEND, type: SESSION_TYPE.qualifying, player: 0 }).frames(10, () => {}).packets();
    a.push(packets);
    await settle();
    const basis = { practice: [practice], qualifying: null };
    expect(value(b.active(A))).toMatchObject({ basis, start: basis, plan: null, raceLaps: null, rebuilding: null, lastChoice: null });
    await a.end();
  });

  it('the team\'s last confirmed choice is published; after a basisChosen the published basis follows it at that frame', async () => {
    const EARLIER = 53;
    const LOBBY = 54;
    const at = new Date(AT.practice).toISOString();
    const b0 = bridge();
    // the last choice names a practice stored in the same database the feed reads
    const practice = await storeSession(b0.db, { uid: 81n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const choice: LastChoice = {
      trackId: TRACK as TrackId,
      basis: { practice: { refs: [practice], at }, qualifying: { ref: null, at } },
      plan: { id: null, at },
    };
    b0.lastChoice.read.mockReturnValue(choice);
    const start = { practice: [practice], qualifying: null };

    const a = b0.feed(A);
    const packets = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 0 }).frames(20, () => {}).packets();
    a.push(slice(packets, 0, 6));
    await settle();
    // a new lobby: the team's last choice on the track is the preselection, and is published
    expect(value(b0.active(A))).toMatchObject({ basis: start, start, plan: null, rebuilding: null, lastChoice: { basis: start, plan: null } });

    const routing = await b0.routing();
    expect(await routing.choose({ kind: 'basis.choose', feedId: A, basis: NO_BASIS, plan: undefined })).toEqual({ ok: true });
    await settle();
    // frame by frame: the published basis is the one the engine's view holds at that frame
    for (let frame = 6; frame < 20; frame++) {
      a.push(slice(packets, frame, frame + 1));
      await settle();
      expect(value(b0.active(A)).basis, `frame ${frame}`).toEqual(last(a.seen).basis);
    }
    expect(chosen(last(a.seen))).toHaveLength(1);
    expect(value(b0.active(A))).toMatchObject({ basis: NO_BASIS, start });
    await a.end();
  });

  // Fix round R18 (the topic file as committed on integ): `sessions` is the picker's candidates.
  it('sessions lists every stored session of the seat on the track, the named ones included, each with stale: a current practice and a stale qualifying, the basis naming only the practice', async () => {
    const EARLIER = 55;
    const LOBBY = 56;
    const ELSEWHERE = 57;
    const OTHER_TRACK = 3;
    const b = bridge();
    const practice = await storeSession(b.db, { uid: 40n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const qualifying = await storeSession(b.db, { uid: 41n, weekend: EARLIER, type: SESSION_TYPE.qualifying, player: 0, at: AT.qualifying });
    markStale(b.db, keyOf(qualifying, 0));
    // not candidates: another seat's session (team 4) and the seat's session on another track
    await storeSession(b.db, { uid: 42n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 2, at: AT.practice });
    await storeSession(b.db, { uid: 43n, weekend: ELSEWHERE, type: SESSION_TYPE.practice, player: 0, at: AT.practice, track: OTHER_TRACK });
    expect(b.db.prepare('SELECT track_id FROM sessions WHERE session_uid = ?').get('43')).toEqual({ track_id: OTHER_TRACK });
    const basis = { practice: [practice], qualifying: null };

    const a = b.feed(A);
    const packets = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 0 }).frames(16, () => {}).packets();
    a.push(slice(packets, 0, 6));
    const routing = await b.routing();
    expect(await routing.choose({ kind: 'basis.choose', feedId: A, basis, plan: undefined })).toEqual({ ok: true });
    await settle();
    a.push(slice(packets, 6, 16));
    await settle();
    expect(last(a.seen).basis).toEqual(basis);

    const published = value(b.active(A));
    expect(published.basis).toEqual(basis);
    const practiceKey = `${practice.sessionUid}@${practice.weekendId}`;
    const qualifyingKey = `${qualifying.sessionUid}@${qualifying.weekendId}`;
    expect(Object.keys(published.sessions).sort()).toEqual([practiceKey, qualifyingKey].sort());
    expect(published.sessions[practiceKey]).toMatchObject({ kind: 'practice', trackId: TRACK, stale: false });
    expect(published.sessions[practiceKey]!.date.slice(0, 10)).toBe(dayOf(AT.practice));
    expect(published.sessions[qualifyingKey]).toMatchObject({ kind: 'qualifying', trackId: TRACK, stale: true });
    expect(published.sessions[qualifyingKey]!.date.slice(0, 10)).toBe(dayOf(AT.qualifying));
    await a.end();
  });
});
