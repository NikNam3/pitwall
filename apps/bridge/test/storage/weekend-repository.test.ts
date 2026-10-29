import { unknown, type DriverKey, type LapRecord, type StintRecord } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { AI9, HUMAN, all, car, history, lap, session, stint } from './records.ts';

function weekend() {
  const db = openDatabase(':memory:');
  const w = new StorageWriter(db, { onError: (e) => { throw e; } });
  w.upsertSession(session('2', { sessionType: 5, startedAt: '2026-10-27T21:00:00.000Z', drivers: [{ carId: car(3), driverKey: AI9 }] }));
  w.upsertSession(session('1', { sessionType: 1 }));                                         // 20:00, AI9 = car 0, HUMAN = car 1
  w.upsertSession(session('3', { weekendId: 'W2', startedAt: '2026-10-27T19:00:00.000Z' }));
  const h1 = history({ laps: [lap(0, 1), lap(1, 1)], stints: [stint(0, 1), stint(1, 1)] });
  const h2 = history({ laps: [lap(3, 1)] });
  w.writeConfirmed('1', h1, all(h1)); w.writeConfirmed('2', h2, all(h2)); w.writeConfirmed('3', h1, all(h1));
  return new WeekendRepository(db);
}

describe('WeekendRepository', () => {
  it('sessionsOf returns the weekend sessions in start order', () => {
    expect(weekend().sessionsOf('W1')).toEqual([session('1', { sessionType: 1 }),
      session('2', { sessionType: 5, startedAt: '2026-10-27T21:00:00.000Z', drivers: [{ carId: car(3), driverKey: AI9 }] })]);
  });
  it('lapsOf filters by DriverKey through the drivers table', () => {
    const repo = weekend();
    expect(repo.lapsOf('1')).toEqual([lap(0, 1), lap(1, 1)]);
    expect(repo.lapsOf('1', HUMAN)).toEqual([lap(1, 1)]);
  });
  it('a lap stored before the lap-end samples existed reads with those fields as unknown("notReceived")', () => {
    const db = openDatabase(':memory:');
    const w = new StorageWriter(db, { onError: (e) => { throw e; } });
    w.upsertSession(session('1'));
    const h = history({ laps: [lap(0, 1)] });
    w.writeConfirmed('1', h, all(h));
    const { wearAtEndPct, ersStoreAtEndJ, ersDeployedJ, ersHarvestedJ, damageAtEnd, channelRange, ...old } = lap(0, 1);
    void [wearAtEndPct, ersStoreAtEndJ, ersDeployedJ, ersHarvestedJ, damageAtEnd, channelRange];
    db.prepare('UPDATE laps SET record = ? WHERE session_uid = ?').run(JSON.stringify(old), '1');
    const [read] = new WeekendRepository(db).lapsOf('1');
    expect(read).toEqual(lap(0, 1));                    // the helper's lap-end samples are all unknown('notReceived')
    expect(read!.damageAtEnd).toEqual(unknown('notReceived'));
    expect(read!.channelRange.tyres.fl.surfaceC).toEqual(unknown('notReceived'));
  });
  it('weekendContext: the player\'s sessions of the weekend, every stored driver with their own records, whatever its car index per session', () => {
    const dr = (driverKey: DriverKey, laps: LapRecord[], stints: StintRecord[] = []) => ({ driverKey, laps, stints, pitStops: [] });
    expect(weekend().weekendContext('W1', AI9)).toEqual({ weekendId: 'W1', driverKey: AI9, sessions: [
      { sessionUid: '1', sessionType: 1, drivers: [dr(AI9, [lap(0, 1)], [stint(0, 1)]), dr(HUMAN, [lap(1, 1)], [stint(1, 1)])] },
      { sessionUid: '2', sessionType: 5, drivers: [dr(AI9, [lap(3, 1)])] }] });
    expect(weekend().weekendContext('W1', HUMAN).sessions.map((s) => s.sessionUid)).toEqual(['1']);
    expect(weekend().weekendContext('W1', HUMAN).sessions[0]!.drivers.map((d) => d.driverKey)).toEqual([AI9, HUMAN]);
  });
  it('weekendContext: drivers are ordered by car id and a driver without records is still listed', () => {
    const db = openDatabase(':memory:');
    const w = new StorageWriter(db, { onError: (e) => { throw e; } });
    const other: DriverKey = { kind: 'ai', driverId: 4 };
    w.upsertSession(session('7', { weekendId: 'W3', drivers: [{ carId: car(5), driverKey: HUMAN }, { carId: car(2), driverKey: AI9 }, { carId: car(4), driverKey: other }] }));
    const h = history({ laps: [lap(5, 1), lap(2, 1), lap(2, 2)] });
    w.writeConfirmed('7', h, all(h));
    const [s] = new WeekendRepository(db).weekendContext('W3', HUMAN).sessions;
    expect(s!.drivers.map((d) => d.driverKey)).toEqual([AI9, other, HUMAN]);
    expect(s!.drivers.map((d) => d.laps)).toEqual([[lap(2, 1), lap(2, 2)], [], [lap(5, 1)]]);
  });
  it('weekendContext with before: only sessions that started earlier', () => {
    expect(weekend().weekendContext('W1', AI9, { before: '2' }).sessions.map((s) => s.sessionUid)).toEqual(['1']);
  });
});
