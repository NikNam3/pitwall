import { describe, expect, it, vi } from 'vitest';
import { openDatabase, type SessionKey } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { HUMAN, all, car, event, history, key, lap, pitStop, sc, session, since, stint } from './records.ts';

const K = key('1');

function setup() {
  const db = openDatabase(':memory:');
  const onError = vi.fn();
  const writer = new StorageWriter(db, { onError });
  writer.upsertSession(session('1'));
  return { db, onError, writer, repo: new WeekendRepository(db) };
}

/** Session '1' of weekend W1 (the `setup` one) and a session of the same uid in weekend W2, each with its own history. */
const W2 = key('1', 'W2');
const w2Session = session('1', { weekendId: 'W2', sessionType: 5, startedAt: '2026-11-03T20:00:00.000Z', drivers: [{ carId: car(0), driverKey: HUMAN }] });
const w1History = history({ laps: [lap(0, 1), lap(1, 1)], stints: [stint(0, 1)], pitStops: [pitStop(1, 3)], flagPhases: [sc(1000)], events: [event(5, 0)] });
const w2History = history({ laps: [lap(0, 1, { lapTimeMs: 91_000 })], stints: [stint(0, 4)], pitStops: [pitStop(0, 2)], flagPhases: [sc(7000)], events: [event(8), event(9, 0)] });
function sameUidTwoWeekends() {
  const s = setup();
  s.writer.upsertSession(w2Session);
  s.writer.writeConfirmed(K, w1History, all(w1History));
  s.writer.writeConfirmed(W2, w2History, all(w2History));
  return s;
}
/** What storage reads back for `k`, as the history lists it was written from (every lap here is confirmed). */
const storedOf = (repo: WeekendRepository, k: SessionKey) =>
  history({ laps: repo.lapsOf(k), stints: repo.stintsOf(k), pitStops: repo.pitStopsOf(k), flagPhases: repo.flagPhasesOf(k), events: repo.eventsOf(k) });

describe('StorageWriter', () => {
  it('writes only confirmed laps; provisional ones are ignored until confirmed', () => {
    const { writer, repo, onError } = setup();
    const h1 = history({ laps: [lap(0, 1, { status: 'provisional' }), lap(0, 1), lap(0, 2, { status: 'provisional' })] });
    writer.writeConfirmed(K, h1, all(h1));
    expect(repo.lapsOf(K)).toEqual([lap(0, 1)]);
    const h2 = history({ laps: [...h1.laps, lap(0, 2)] });
    writer.writeConfirmed(K, h2, since(h1, h2));
    expect(repo.lapsOf(K)).toEqual([lap(0, 1), lap(0, 2)]);
    expect(onError).not.toHaveBeenCalled();
  });
  it('upserts by (session, car, lap): the last confirmed value wins', () => {
    const { writer, repo } = setup();
    const h = history({ laps: [lap(0, 1, { lapTimeMs: 90_100 }), lap(0, 1, { lapTimeMs: 90_000 })] });
    writer.writeConfirmed(K, h, all(h));
    expect(repo.lapsOf(K).map((l) => l.lapTimeMs)).toEqual([90_000]);
  });
  it('is idempotent', () => {
    const { db, writer, repo } = setup();
    const h = history({ laps: [lap(0, 1)], stints: [stint(0, 1)], flagPhases: [sc(1000)], events: [event(5, 0), event(6)] });
    writer.writeConfirmed(K, h, all(h));
    writer.writeConfirmed(K, h, all(h));
    expect(db.prepare('SELECT count(*) FROM events').pluck().get()).toBe(2);
    expect(repo.stintsOf(K)).toEqual([stint(0, 1)]);
    expect(repo.flagPhasesOf(K)).toEqual([sc(1000)]);
    expect(repo.eventsOf(K)).toEqual([event(5, 0), event(6)]);
  });
  it('a truncated delta (flashback) rewrites the session history', () => {
    const { writer, repo } = setup();
    const h1 = history({ laps: [lap(0, 1), lap(0, 2)], events: [event(1), event(2), event(3)] });
    writer.writeConfirmed(K, h1, all(h1));
    const h2 = history({ laps: [lap(0, 1)], events: [event(1), event(9)] });
    writer.writeConfirmed(K, h2, since(h1, h2, true));
    expect(repo.lapsOf(K)).toEqual([lap(0, 1)]);
    expect(repo.eventsOf(K)).toEqual([event(1), event(9)]);
  });
  it('one transaction per call: a failure rolls back the batch, calls onError and does not throw', () => {
    const { db, writer, onError } = setup();
    db.exec("CREATE TRIGGER fail_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    const h = history({ laps: [lap(0, 1)], events: [event(1)] });
    expect(() => writer.writeConfirmed(K, h, all(h))).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]![0])).toContain('boom');
    expect(db.prepare('SELECT count(*) FROM laps').pluck().get()).toBe(0);
  });
  it('a closed database is reported through onError', () => {
    const { db, writer, onError } = setup();
    db.close();
    expect(() => writer.upsertSession(session('2'))).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });
  it('two sessions with the same uid in different weekends are stored side by side, each with its own row, drivers and records', () => {
    const { repo, onError } = sameUidTwoWeekends();
    expect(repo.sessionsOf('W1')).toEqual([session('1')]);
    expect(repo.sessionsOf('W2')).toEqual([w2Session]);
    expect(storedOf(repo, K)).toEqual(w1History);
    expect(storedOf(repo, W2)).toEqual(w2History);
    expect(onError).not.toHaveBeenCalled();
  });
  it('a flashback of one session clears only its records, not those of the same uid in another weekend', () => {
    const { writer, repo, onError } = sameUidTwoWeekends();
    const h = history({ laps: [], events: [event(8)] });
    writer.writeConfirmed(W2, h, since(w2History, h, true));
    expect(storedOf(repo, W2)).toEqual(h);
    expect(storedOf(repo, K)).toEqual(w1History);
    expect(onError).not.toHaveBeenCalled();
  });
  it('deleteSessions of one key keeps the session with the same uid in another weekend', () => {
    const { writer, repo, onError } = sameUidTwoWeekends();
    writer.deleteSessions([W2]);
    expect(repo.sessionsOf('W2')).toEqual([]);
    expect(storedOf(repo, W2)).toEqual(history());
    expect(repo.sessionsOf('W1')).toEqual([session('1')]);
    expect(storedOf(repo, K)).toEqual(w1History);
    expect(onError).not.toHaveBeenCalled();
  });
});
