import { known, unknown, type DriverKey, type LapRecord, type StintRecord } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { AI9, HUMAN, all, car, event, history, key, lap, pitStop, session, stint } from './records.ts';

function storage() {
  const db = openDatabase(':memory:');
  return { w: new StorageWriter(db, { onError: (e) => { throw e; } }), repo: new WeekendRepository(db) };
}

function weekend() {
  const db = openDatabase(':memory:');
  const w = new StorageWriter(db, { onError: (e) => { throw e; } });
  w.upsertSession(session('2', { sessionType: 'qualifying:grandPrix:1', startedAt: '2026-10-27T21:00:00.000Z', drivers: [{ carId: car(3), driverKey: AI9 }] }));
  w.upsertSession(session('1', { sessionType: 'practice:practice:1' }));                                         // 20:00, AI9 = car 0, HUMAN = car 1
  w.upsertSession(session('3', { weekendId: 'W2', startedAt: '2026-10-27T19:00:00.000Z' }));
  const h1 = history({ laps: [lap(0, 1), lap(1, 1)], stints: [stint(0, 1), stint(1, 1)] });
  const h2 = history({ laps: [lap(3, 1)] });
  w.writeConfirmed(key('1'), h1, all(h1)); w.writeConfirmed(key('2'), h2, all(h2)); w.writeConfirmed(key('3', 'W2'), h1, all(h1));
  return new WeekendRepository(db);
}

describe('WeekendRepository', () => {
  it('sessionsOf returns the weekend sessions in start order', () => {
    expect(weekend().sessionsOf('W1')).toEqual([session('1', { sessionType: 'practice:practice:1' }),
      session('2', { sessionType: 'qualifying:grandPrix:1', startedAt: '2026-10-27T21:00:00.000Z', drivers: [{ carId: car(3), driverKey: AI9 }] })]);
  });
  it('lapsOf filters by DriverKey through the drivers table', () => {
    const repo = weekend();
    expect(repo.lapsOf(key('1'))).toEqual([lap(0, 1), lap(1, 1)]);
    expect(repo.lapsOf(key('1'), HUMAN)).toEqual([lap(1, 1)]);
  });
  /** The laps of a stored session whose lap 1 record is `record` (as an older version wrote it). */
  const storedAs = (record: object) => {
    const db = openDatabase(':memory:');
    const w = new StorageWriter(db, { onError: (e) => { throw e; } });
    w.upsertSession(session('1'));
    const h = history({ laps: [lap(0, 1)] });
    w.writeConfirmed(key('1'), h, all(h));
    db.prepare('UPDATE laps SET record = ? WHERE session_uid = ?').run(JSON.stringify(record), '1');
    return new WeekendRepository(db).lapsOf(key('1'));
  };
  it('a lap stored before the lap-start and lap-end samples existed reads with those fields as unknown("notReceived")', () => {
    const { wearAtStartPct, ersStoreAtStartJ, wearAtEndPct, ersStoreAtEndJ, ersDeployedJ, ersHarvestedJ, damageAtEnd, channelRange, ...old } = lap(0, 1);
    void [wearAtStartPct, ersStoreAtStartJ, wearAtEndPct, ersStoreAtEndJ, ersDeployedJ, ersHarvestedJ, damageAtEnd, channelRange];
    const [read] = storedAs(old);
    expect(read).toEqual(lap(0, 1));                    // the helper's samples are all unknown('notReceived')
    expect(read!.damageAtEnd).toEqual(unknown('notReceived'));
    expect(read!.channelRange.tyres.fl.surfaceC).toEqual(unknown('notReceived'));
  });
  it('a lap stored with the lap-end samples but before the lap-start samples existed reads with the start samples as unknown("notReceived")', () => {
    const wear = { fl: known(8, 90_000), fr: known(7, 90_000), rl: known(6, 90_000), rr: known(5, 90_000) };
    const { wearAtStartPct, ersStoreAtStartJ, ...old } = lap(0, 1, { wearAtEndPct: wear, ersStoreAtEndJ: known(3_000_000, 90_000) });
    void [wearAtStartPct, ersStoreAtStartJ];
    const [read] = storedAs(old);
    expect(read).toEqual({ ...old, wearAtStartPct: lap(0, 1).wearAtStartPct, ersStoreAtStartJ: unknown('notReceived') });
  });
  it('weekendContext: the player\'s sessions of the weekend, every stored driver with their own records, whatever its car index per session', () => {
    const dr = (driverKey: DriverKey, laps: LapRecord[], stints: StintRecord[] = []) => ({ driverKey, laps, stints, pitStops: [] });
    expect(weekend().weekendContext('W1', AI9)).toEqual({ weekendId: 'W1', driverKey: AI9, sessions: [
      { sessionUid: '1', sessionType: 'practice:practice:1', drivers: [dr(AI9, [lap(0, 1)], [stint(0, 1)]), dr(HUMAN, [lap(1, 1)], [stint(1, 1)])] },
      { sessionUid: '2', sessionType: 'qualifying:grandPrix:1', drivers: [dr(AI9, [lap(3, 1)])] }] });
    expect(weekend().weekendContext('W1', HUMAN).sessions.map((s) => s.sessionUid)).toEqual(['1']);
    expect(weekend().weekendContext('W1', HUMAN).sessions[0]!.drivers.map((d) => d.driverKey)).toEqual([AI9, HUMAN]);
  });
  it('weekendContext: drivers are ordered by car id and a driver without records is still listed', () => {
    const db = openDatabase(':memory:');
    const w = new StorageWriter(db, { onError: (e) => { throw e; } });
    const other: DriverKey = { name: 'DRIVER 4', networkId: 255 };
    w.upsertSession(session('7', { weekendId: 'W3', drivers: [{ carId: car(5), driverKey: HUMAN }, { carId: car(2), driverKey: AI9 }, { carId: car(4), driverKey: other }] }));
    const h = history({ laps: [lap(5, 1), lap(2, 1), lap(2, 2)] });
    w.writeConfirmed(key('7', 'W3'), h, all(h));
    const [s] = new WeekendRepository(db).weekendContext('W3', HUMAN).sessions;
    expect(s!.drivers.map((d) => d.driverKey)).toEqual([AI9, other, HUMAN]);
    expect(s!.drivers.map((d) => d.laps)).toEqual([[lap(2, 1), lap(2, 2)], [], [lap(5, 1)]]);
  });
  it('weekendContext with before: only sessions that started earlier', () => {
    expect(weekend().weekendContext('W1', AI9, { before: '2' }).sessions.map((s) => s.sessionUid)).toEqual(['1']);
  });
  it('each per-session read returns only the keyed session\'s records when another weekend holds the same uid', () => {
    const { w, repo } = storage();
    const h1 = history({ laps: [lap(0, 1)], stints: [stint(0, 1)], pitStops: [pitStop(0, 3)], events: [event(5, 0)] });
    const h2 = history({ laps: [lap(1, 1), lap(1, 2)], stints: [stint(1, 1)], pitStops: [pitStop(1, 2)], events: [event(6)] });
    w.upsertSession(session('1')); w.upsertSession(session('1', { weekendId: 'W2' }));
    w.writeConfirmed(key('1'), h1, all(h1)); w.writeConfirmed(key('1', 'W2'), h2, all(h2));
    for (const [k, h] of [[key('1'), h1], [key('1', 'W2'), h2]] as const) {
      expect([repo.lapsOf(k), repo.stintsOf(k), repo.pitStopsOf(k), repo.eventsOf(k)])
        .toEqual([h.laps, h.stints, h.pitStops, h.events]);
    }
  });
  it('a read by driver key matches the driver of the keyed session, not the same car of the same uid in another weekend', () => {
    const { w, repo } = storage();
    w.upsertSession(session('1'));                                                             // car 0 = AI9, car 1 = HUMAN
    w.upsertSession(session('1', { weekendId: 'W2', drivers: [{ carId: car(0), driverKey: HUMAN }, { carId: car(1), driverKey: AI9 }] }));
    const h = history({ laps: [lap(0, 1), lap(1, 1)], stints: [stint(0, 1), stint(1, 1)], pitStops: [pitStop(0, 3), pitStop(1, 4)] });
    w.writeConfirmed(key('1'), h, all(h)); w.writeConfirmed(key('1', 'W2'), h, all(h));
    expect([repo.lapsOf(key('1'), HUMAN), repo.stintsOf(key('1'), HUMAN), repo.pitStopsOf(key('1'), HUMAN)])
      .toEqual([[lap(1, 1)], [stint(1, 1)], [pitStop(1, 4)]]);
    expect([repo.lapsOf(key('1', 'W2'), HUMAN), repo.stintsOf(key('1', 'W2'), HUMAN), repo.pitStopsOf(key('1', 'W2'), HUMAN)])
      .toEqual([[lap(0, 1)], [stint(0, 1)], [pitStop(0, 3)]]);
  });
  it('weekendContext: a session\'s drivers and records are those of its own weekend when the uid also exists in another', () => {
    const { w, repo } = storage();
    w.upsertSession(session('1', { drivers: [{ carId: car(0), driverKey: AI9 }] }));
    w.upsertSession(session('1', { weekendId: 'W2', drivers: [{ carId: car(0), driverKey: HUMAN }, { carId: car(1), driverKey: AI9 }] }));
    const h1 = history({ laps: [lap(0, 1)] });
    const h2 = history({ laps: [lap(0, 1, { lapTimeMs: 91_000 }), lap(1, 1)] });
    w.writeConfirmed(key('1'), h1, all(h1)); w.writeConfirmed(key('1', 'W2'), h2, all(h2));
    expect(repo.weekendContext('W1', AI9)).toEqual({ weekendId: 'W1', driverKey: AI9, sessions: [
      { sessionUid: '1', sessionType: 'practice:practice:1', drivers: [{ driverKey: AI9, laps: [lap(0, 1)], stints: [], pitStops: [] }] }] });
    expect(repo.weekendContext('W1', HUMAN).sessions).toEqual([]);                             // HUMAN drove only the W2 session
  });
  it('weekendContext with before: the start time is that of the before session in its own weekend, not of its uid in another', () => {
    const { w, repo } = storage();
    w.upsertSession(session('P', { weekendId: 'W2', startedAt: '2026-10-27T20:00:00.000Z' }));
    w.upsertSession(session('Q', { weekendId: 'W2', startedAt: '2026-10-27T21:00:00.000Z' }));
    w.upsertSession(session('Q', { weekendId: 'W1', startedAt: '2026-10-20T19:00:00.000Z' }));  // same uid, an earlier weekend
    expect(repo.weekendContext('W2', AI9, { before: 'Q' }).sessions.map((s) => s.sessionUid)).toEqual(['P']);
  });
});
