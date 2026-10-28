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
  it('weekendContext: same weekend, that DriverKey only, whatever its car index per session', () => {
    expect(weekend().weekendContext('W1', AI9)).toEqual({ weekendId: 'W1', driverKey: AI9, sessions: [
      { sessionUid: '1', sessionType: 1, laps: [lap(0, 1)], stints: [stint(0, 1)], pitStops: [] },
      { sessionUid: '2', sessionType: 5, laps: [lap(3, 1)], stints: [], pitStops: [] }] });
    expect(weekend().weekendContext('W1', HUMAN).sessions.map((s) => s.sessionUid)).toEqual(['1']);
  });
  it('weekendContext with before: only sessions that started earlier', () => {
    expect(weekend().weekendContext('W1', AI9, { before: '2' }).sessions.map((s) => s.sessionUid)).toEqual(['1']);
  });
});
